import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OtpType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { isPrismaError } from '../../common/helpers/prisma.helpers';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import {
  AuthErrorCode,
  BCRYPT_ROUNDS,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import {
  ChangePasswordDto,
  LoginDto,
  OtpCodeDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { AuthSession, AuthTokens } from './interfaces/auth.interface';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

// Orchestrates the auth flows. Codes live in OtpService, tokens in
// TokenService, user data in UsersService.
//
// Concurrency: every transaction that issues or revokes a user's sessions or
// codes starts with usersService.lockForUpdate, so e.g. a password reset can't
// miss a refresh token that is being issued at the same moment.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    if (await this.usersService.findByEmail(dto.email)) {
      throw this.emailTaken();
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let created: { user: PublicUser; code: string | null };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await this.usersService.create(
          {
            email: dto.email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
          tx,
        );
        const code = await this.otpService.issue(
          user.id,
          OtpType.VERIFICATION,
          tx,
        );
        return { user, code };
      });
    } catch (error) {
      // Lost a race with a concurrent registration of the same email
      if (isPrismaError(error, 'P2002')) {
        throw this.emailTaken();
      }
      throw error;
    }

    const { user, code } = created;
    if (code) {
      this.runInBackground(() =>
        this.mailService.sendVerificationOtp(
          user.email,
          code,
          this.otpService.expiryMinutes,
        ),
      );
    }
    return user;
  }

  async login(dto: LoginDto, client: ClientMeta): Promise<AuthSession> {
    const record = await this.usersService.findWithPasswordByEmail(dto.email);
    // Unknown emails are checked against a dummy hash so both cases take as long
    const passwordMatches = await bcrypt.compare(
      dto.password,
      record?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!record || !passwordMatches) {
      throw this.invalidCredentials();
    }

    const { password: verifiedHash, ...user } = record;
    this.assertActive(user);

    const session = await this.prisma.$transaction(async (tx) => {
      if (!(await this.usersService.lockForUpdate(user.id, tx))) {
        return null; // deleted meanwhile
      }
      // The password may have been reset or the account disabled while
      // bcrypt was running
      const current = await this.usersService.findWithPasswordById(user.id, tx);
      if (current?.password !== verifiedHash || !current.isActive) {
        return null;
      }
      return this.startSession(user, client, tx);
    });
    if (!session) {
      throw this.invalidCredentials();
    }
    return session;
  }

  async verifyEmail(dto: OtpCodeDto): Promise<void> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.isEmailVerified) {
      throw this.invalidCode();
    }

    // Return instead of throwing inside the transaction: a rollback would undo
    // the attempt counter and lift the brute-force limit
    const verified = await this.prisma.$transaction(async (tx) => {
      const consumed = await this.otpService.consume(
        user.id,
        OtpType.VERIFICATION,
        dto.otpCode,
        tx,
      );
      if (consumed) {
        await this.usersService.markEmailVerified(user.id, tx);
      }
      return consumed;
    });
    if (!verified) {
      throw this.invalidCode();
    }
  }

  resendVerification(email: string): void {
    this.runInBackground(async () => {
      const user = await this.usersService.findByEmail(email);
      if (!user?.isActive || user.isEmailVerified) {
        return;
      }
      const code = await this.issueCode(user.id, OtpType.VERIFICATION);
      if (code) {
        await this.mailService.sendVerificationOtp(
          email,
          code,
          this.otpService.expiryMinutes,
        );
      }
    });
  }

  forgotPassword(email: string): void {
    this.runInBackground(async () => {
      const user = await this.usersService.findByEmail(email);
      if (!user?.isActive) {
        return;
      }
      const code = await this.issueCode(user.id, OtpType.PASSWORD_RESET);
      if (code) {
        await this.mailService.sendPasswordResetOtp(
          email,
          code,
          this.otpService.expiryMinutes,
        );
      }
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Hashed first so unknown emails don't answer noticeably faster
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const user = await this.usersService.findByEmail(dto.email);
    // A code issued before the account was disabled must not reopen it
    if (!user?.isActive) {
      throw this.invalidCode();
    }

    const reset = await this.prisma.$transaction(async (tx) => {
      if (!(await this.usersService.lockForUpdate(user.id, tx))) {
        return false;
      }
      const consumed = await this.otpService.consume(
        user.id,
        OtpType.PASSWORD_RESET,
        dto.otpCode,
        tx,
      );
      if (consumed) {
        await this.usersService.setPassword(user.id, passwordHash, tx);
        // Whoever knew the old password is signed out everywhere
        await this.tokenService.revokeAllForUser(user.id, tx);
      }
      return consumed;
    });
    if (!reset) {
      throw this.invalidCode();
    }
  }

  // Signs out every other session and returns a fresh pair for this one
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    client: ClientMeta,
  ): Promise<AuthTokens> {
    const record = await this.usersService.findWithPasswordById(userId);
    if (!record) {
      throw new UnauthorizedException();
    }
    if (!(await bcrypt.compare(dto.currentPassword, record.password))) {
      throw this.currentPasswordIncorrect();
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.usersService.lockForUpdate(userId, tx);
      const current = locked
        ? await this.usersService.findWithPasswordById(userId, tx)
        : null;
      if (!current) {
        throw new UnauthorizedException(); // deleted meanwhile
      }
      // A concurrent reset or change wins; this one must not overwrite it
      if (current.password !== record.password) {
        throw this.currentPasswordIncorrect();
      }
      await this.usersService.setPassword(userId, passwordHash, tx);
      await this.tokenService.revokeAllForUser(userId, tx);
      return this.tokenService.issue(record, client, tx);
    });
  }

  sendLoginOtp(email: string): void {
    this.runInBackground(async () => {
      const user = await this.usersService.findByEmail(email);
      if (!user?.isActive) {
        return;
      }
      const code = await this.issueCode(user.id, OtpType.LOGIN);
      if (code) {
        await this.mailService.sendOtpEmail(
          email,
          code,
          this.otpService.expiryMinutes,
        );
      }
    });
  }

  async verifyLoginOtp(
    dto: OtpCodeDto,
    client: ClientMeta,
  ): Promise<AuthSession> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user?.isActive) {
      throw this.invalidCode();
    }

    const session = await this.prisma.$transaction(async (tx) => {
      if (!(await this.usersService.lockForUpdate(user.id, tx))) {
        return null;
      }
      const consumed = await this.otpService.consume(
        user.id,
        OtpType.LOGIN,
        dto.otpCode,
        tx,
      );
      return consumed ? this.startSession(user, client, tx) : null;
    });
    if (!session) {
      throw this.invalidCode();
    }
    return session;
  }

  refresh(refreshToken: string, client: ClientMeta): Promise<AuthTokens> {
    return this.tokenService.rotate(refreshToken, client);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokenService.revoke(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.usersService.lockForUpdate(userId, tx);
      await this.tokenService.revokeAllForUser(userId, tx);
    });
  }

  private async startSession(
    user: PublicUser,
    client: ClientMeta,
    tx: Prisma.TransactionClient,
  ): Promise<AuthSession> {
    const updated = await this.usersService.recordLogin(user.id, tx);
    const tokens = await this.tokenService.issue(updated, client, tx);
    return { ...tokens, user: updated };
  }

  // Null while the account is rate limited for this code type (OtpService)
  private issueCode(userId: string, type: OtpType): Promise<string | null> {
    return this.prisma.$transaction(async (tx) =>
      (await this.usersService.lockForUpdate(userId, tx))
        ? this.otpService.issue(userId, type, tx)
        : null,
    );
  }

  private assertActive(user: PublicUser): void {
    if (!user.isActive) {
      throw new ForbiddenException({
        errorCode: AuthErrorCode.ACCOUNT_DISABLED,
        message: 'This account has been disabled',
      });
    }
  }

  // Work that must not delay the response. The code-sending flows run entirely
  // here, so their response time doesn't depend on whether the account exists
  // (no user lookup, code issuing or SMTP on the response path). Failures are
  // logged; users can ask for a new code.
  private runInBackground(task: () => Promise<void>): void {
    void task().catch((error: unknown) => {
      this.logger.error(
        'Background task failed',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private emailTaken() {
    return new ConflictException({
      errorCode: AuthErrorCode.EMAIL_TAKEN,
      message: 'An account with this email already exists',
    });
  }

  private invalidCredentials() {
    return new UnauthorizedException({
      errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      message: 'Email or password is incorrect',
    });
  }

  private currentPasswordIncorrect() {
    return new UnprocessableEntityException({
      errorCode: AuthErrorCode.CURRENT_PASSWORD_INCORRECT,
      message: 'Current password is incorrect',
    });
  }

  // 422: a well-formed code that is wrong, expired or used up
  private invalidCode() {
    return new UnprocessableEntityException({
      errorCode: AuthErrorCode.INVALID_CODE,
      message: 'Invalid or expired code',
    });
  }
}
