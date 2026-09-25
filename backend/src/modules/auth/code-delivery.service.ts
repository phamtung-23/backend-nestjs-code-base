import { Injectable, Logger } from '@nestjs/common';
import { OtpType } from '@prisma/client';
import { runInBackground } from '../../common/helpers/background.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { OTP_MAIL_METHOD } from './auth.constants';
import { OtpService } from './otp.service';

// Issues one-time codes and emails them
@Injectable()
export class CodeDeliveryService {
  private readonly logger = new Logger(CodeDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
  ) {}

  // For the public "send me a code" endpoints. Everything (lookup, issuing,
  // SMTP) runs after the response, so its timing doesn't reveal whether the
  // account exists; unknown or ineligible accounts silently get nothing.
  sendInBackground(
    email: string,
    type: OtpType,
    isEligible: (user: PublicUser) => boolean,
  ): void {
    runInBackground(this.logger, async () => {
      const user = await this.usersService.findByEmail(email);
      if (!user || !isEligible(user)) {
        return;
      }
      const code = await this.issue(user.id, type);
      if (code) {
        await this.deliver(email, type, code);
      }
    });
  }

  // Emails a code that was issued in the caller's transaction, after commit
  deliverInBackground(email: string, type: OtpType, code: string): void {
    runInBackground(this.logger, () => this.deliver(email, type, code));
  }

  // Null while the account is rate limited for this code type (OtpService)
  private issue(userId: string, type: OtpType): Promise<string | null> {
    return this.prisma.$transaction(async (tx) =>
      (await this.usersService.lockForUpdate(userId, tx))
        ? this.otpService.issue(userId, type, tx)
        : null,
    );
  }

  private deliver(email: string, type: OtpType, code: string): Promise<void> {
    return this.mailService[OTP_MAIL_METHOD[type]](
      email,
      code,
      this.otpService.expiryMinutes,
    );
  }
}
