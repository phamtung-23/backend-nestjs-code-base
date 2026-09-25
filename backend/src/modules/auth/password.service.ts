import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OtpType } from '@prisma/client';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { AuthErrors } from './auth.errors';
import { CodeDeliveryService } from './code-delivery.service';
import { CredentialsService } from './credentials.service';
import { ChangePasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { AuthTokens } from './interfaces/auth.interface';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

// Forgotten password (emailed code) and password change. Both sign the user
// out everywhere in the same transaction as the password write.
@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly credentials: CredentialsService,
    private readonly codeDelivery: CodeDeliveryService,
    private readonly auditService: AuditService,
  ) {}

  forgotPassword(email: string): void {
    this.codeDelivery.sendInBackground(
      email,
      OtpType.PASSWORD_RESET,
      (user) => user.isActive,
    );
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Hashed first so unknown emails don't answer noticeably faster
    const passwordHash = await this.credentials.hash(dto.newPassword);
    const user = await this.usersService.findByEmail(dto.email);
    // A code issued before the account was disabled must not reopen it
    if (!user?.isActive) {
      throw AuthErrors.invalidCode();
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
      throw AuthErrors.invalidCode();
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
    if (
      !(await this.credentials.matches(dto.currentPassword, record.password))
    ) {
      throw AuthErrors.currentPasswordIncorrect();
    }
    const passwordHash = await this.credentials.hash(dto.newPassword);

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
        throw AuthErrors.currentPasswordIncorrect();
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
      // Issued after the revoke, or it would be revoked too
      return this.tokenService.startSession(
        record,
        client,
        tx,
        'password_change',
      );
    });
  }
}
