import { Injectable } from '@nestjs/common';
import { OtpType, Prisma } from '@prisma/client';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { AuthErrors } from './auth.errors';
import { CodeDeliveryService } from './code-delivery.service';
import { CredentialsService } from './credentials.service';
import { LoginDto, OtpCodeDto } from './dto/auth.dto';
import {
  AuthSession,
  AuthTokens,
  SessionMethod,
} from './interfaces/auth.interface';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

// Sessions: log in (password or emailed code), refresh, log out. Sign-up is in
// RegistrationService, passwords in PasswordService.
//
// Concurrency: every transaction that issues or revokes a user's sessions or
// codes starts with usersService.lockForUpdate, so e.g. a password reset can't
// miss a refresh token that is being issued at the same moment.
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly credentials: CredentialsService,
    private readonly codeDelivery: CodeDeliveryService,
    private readonly auditService: AuditService,
  ) {}

  async login(dto: LoginDto, client: ClientMeta): Promise<AuthSession> {
    const record = await this.credentials.verify(dto.email, dto.password);
    const { password: verifiedHash, ...user } = record;
    // Checked only after the password matched, so it reveals nothing to
    // strangers. It also stops someone who registered another person's email
    // from using the account: they can never verify it.
    if (!user.isEmailVerified) {
      throw AuthErrors.emailNotVerified();
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
      throw AuthErrors.invalidCredentials();
    }
    return session;
  }

  sendLoginOtp(email: string): void {
    this.codeDelivery.sendInBackground(
      email,
      OtpType.LOGIN,
      (user) => user.isActive,
    );
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
      throw AuthErrors.invalidCode();
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
      throw AuthErrors.invalidCode();
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
    method: SessionMethod,
  ): Promise<AuthSession> {
    const updated = await this.usersService.recordLogin(user.id, tx);
    const tokens = await this.tokenService.startSession(
      updated,
      client,
      tx,
      method,
    );
    return { ...tokens, user: updated };
  }
}
