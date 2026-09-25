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
import { randomUUID } from 'node:crypto';
import { isPrismaError } from '../../common/helpers/prisma.helpers';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import {
  PublicUser,
  UserWithPassword,
} from '../users/interfaces/user.interface';
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
  VerifyEmailDto,
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
    private readonly auditService: AuditService,
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
        await this.auditService.log(
          {
            action: AuditAction.USER_REGISTERED,
            entity: AuditEntity.USER,
            entityId: user.id,
            actorId: user.id,
          },
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
    const record = await this.checkCredentials(dto.email, dto.password, true);
    const { password: verifiedHash, ...user } = record;
    // Checked only after the password matched, so it reveals nothing to
    // strangers. It also stops someone who registered another person's email
    // from using the account: they can never verify it.
    if (!user.isEmailVerified) {
      throw new ForbiddenException({
        errorCode: AuthErrorCode.EMAIL_NOT_VERIFIED,
        message: 'Verify your email address before logging in with a password',
      });
    }

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
      return this.startSession(user, client, tx, 'password');
    });
    if (!session) {
      throw this.invalidCredentials();
    }
    return session;
  }

  // Requires the password as well as the code: it proves the person verifying
  // is the one who registered. Otherwise an email owner verifying an account
  // someone else registered first would make that person's password usable;
  // the owner takes such an account over with a password reset instead.
  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    // Wrong passwords are audited like failed logins: this is a password check too
    const user = await this.checkCredentials(dto.email, dto.password, true);
    if (user.isEmailVerified) {
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
        await this.auditService.log(
          {
            action: AuditAction.USER_EMAIL_VERIFIED,
            entity: AuditEntity.USER,
            entityId: user.id,
            actorId: user.id,
          },
          tx,
        );
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
        // The code reached the mailbox, which proves ownership of the email
        if (!user.isEmailVerified) {
          await this.usersService.markEmailVerified(user.id, tx);
        }
        // Whoever knew the old password is signed out everywhere
        await this.tokenService.revokeAllForUser(user.id, tx);
        await this.auditService.log(
          {
            action: AuditAction.USER_PASSWORD_RESET,
            entity: AuditEntity.USER,
            entityId: user.id,
            actorId: user.id,
          },
          tx,
        );
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
      await this.auditService.log(
        {
          action: AuditAction.USER_PASSWORD_CHANGED,
          entity: AuditEntity.USER,
          entityId: userId,
          actorId: userId,
        },
        tx,
      );
      return this.openSession(record, client, tx, 'password_change');
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

  // Works for unverified accounts too, but deliberately doesn't mark the email
  // verified: that would make a password chosen by whoever registered the
  // address first usable. Verification happens via verify-email or a reset.
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
      return consumed ? this.startSession(user, client, tx, 'code') : null;
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
      if (!(await this.usersService.lockForUpdate(userId, tx))) {
        return; // deleted meanwhile
      }
      const revokedTokens = await this.tokenService.revokeAllForUser(
        userId,
        tx,
      );
      // Repeated calls with nothing left to revoke would only add noise rows
      if (revokedTokens === 0) {
        return;
      }
      await this.auditService.log(
        {
          action: AuditAction.USER_SESSIONS_REVOKED,
          entity: AuditEntity.USER,
          entityId: userId,
          actorId: userId,
          metadata: { revokedTokens },
        },
        tx,
      );
    });
  }

  private async startSession(
    user: PublicUser,
    client: ClientMeta,
    tx: Prisma.TransactionClient,
    method: 'password' | 'code',
  ): Promise<AuthSession> {
    const updated = await this.usersService.recordLogin(user.id, tx);
    const tokens = await this.openSession(updated, client, tx, method);
    return { ...tokens, user: updated };
  }

  // A new refresh token family, recorded so later session.ended /
  // session.reuse_detected entries point at a session the trail knows
  private async openSession(
    user: Pick<PublicUser, 'id' | 'email' | 'role'>,
    client: ClientMeta,
    tx: Prisma.TransactionClient,
    method: 'password' | 'code' | 'password_change',
  ): Promise<AuthTokens> {
    const familyId = randomUUID();
    const tokens = await this.tokenService.issue(user, client, tx, familyId);
    await this.auditService.log(
      {
        action: AuditAction.SESSION_STARTED,
        entity: AuditEntity.SESSION,
        entityId: familyId,
        actorId: user.id,
        metadata: { method },
      },
      tx,
    );
    return tokens;
  }

  // Null while the account is rate limited for this code type (OtpService)
  private issueCode(userId: string, type: OtpType): Promise<string | null> {
    return this.prisma.$transaction(async (tx) =>
      (await this.usersService.lockForUpdate(userId, tx))
        ? this.otpService.issue(userId, type, tx)
        : null,
    );
  }

  // Password check shared by login and verify-email. Unknown emails are
  // compared against a dummy hash so both cases take as long and answer alike.
  private async checkCredentials(
    email: string,
    password: string,
    auditFailures = false,
  ): Promise<UserWithPassword> {
    const record = await this.usersService.findWithPasswordByEmail(email);
    const passwordMatches = await bcrypt.compare(
      password,
      record?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (record && !passwordMatches && auditFailures) {
      // In the background, so a wrong password for an existing account isn't
      // slower than one for an unknown email
      const userId = record.id;
      this.runInBackground(() =>
        this.auditService.log({
          action: AuditAction.USER_LOGIN_FAILED,
          entity: AuditEntity.USER,
          entityId: userId,
          metadata: { reason: 'wrong_password' },
        }),
      );
    }
    if (!record || !passwordMatches) {
      throw this.invalidCredentials();
    }
    this.assertActive(record);
    return record;
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
