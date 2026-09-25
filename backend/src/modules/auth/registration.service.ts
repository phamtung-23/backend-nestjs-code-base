import { Injectable } from '@nestjs/common';
import { OtpType } from '@prisma/client';
import { isPrismaError } from '../../common/helpers/prisma.helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { AuthErrors } from './auth.errors';
import { CodeDeliveryService } from './code-delivery.service';
import { CredentialsService } from './credentials.service';
import { RegisterDto, VerifyEmailDto } from './dto/auth.dto';
import { OtpService } from './otp.service';

// Sign-up and email verification
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly credentials: CredentialsService,
    private readonly codeDelivery: CodeDeliveryService,
    private readonly auditService: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    if (await this.usersService.findByEmail(dto.email)) {
      throw AuthErrors.emailTaken();
    }
    const passwordHash = await this.credentials.hash(dto.password);

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
        throw AuthErrors.emailTaken();
      }
      throw error;
    }

    const { user, code } = created;
    if (code) {
      this.codeDelivery.deliverInBackground(
        user.email,
        OtpType.VERIFICATION,
        code,
      );
    }
    return user;
  }

  // Requires the password as well as the code: it proves the person verifying
  // is the one who registered. Otherwise an email owner verifying an account
  // someone else registered first would make that person's password usable;
  // the owner takes such an account over with a password reset instead.
  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    // Wrong passwords are audited like failed logins: this is a password check too
    const user = await this.credentials.verify(dto.email, dto.password);
    if (user.isEmailVerified) {
      throw AuthErrors.invalidCode();
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
      throw AuthErrors.invalidCode();
    }
  }

  resendVerification(email: string): void {
    this.codeDelivery.sendInBackground(
      email,
      OtpType.VERIFICATION,
      (user) => user.isActive && !user.isEmailVerified,
    );
  }
}
