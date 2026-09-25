import { Inject, Injectable, Logger } from '@nestjs/common';
import { maskEmail, maskEmailsIn } from '../../common/helpers/mask.helpers';
import { MAIL_SENDER } from './mail.constants';
import { MailSender } from './interfaces/mail-sender.interface';
import { codeEmail, CodeEmailKind } from './templates/code-email.template';

// The app's emails. Builds each message from its template and hands it to the
// MailSender port; knows nothing about the transport.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(MAIL_SENDER) private readonly sender: MailSender) {}

  sendVerificationOtp(
    email: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    return this.sendCode(email, 'verification', code, expiresInMinutes);
  }

  sendPasswordResetOtp(
    email: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    return this.sendCode(email, 'passwordReset', code, expiresInMinutes);
  }

  sendLoginOtp(
    email: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    return this.sendCode(email, 'login', code, expiresInMinutes);
  }

  private async sendCode(
    email: string,
    kind: CodeEmailKind,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    try {
      await this.sender.send({
        to: email,
        ...codeEmail(kind, code, expiresInMinutes),
      });
    } catch (error) {
      // Transport errors can echo the recipient (SMTP replies do)
      this.logger.error(
        `Failed to send the ${kind} email to ${maskEmail(email)}`,
        maskEmailsIn(
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        ),
      );
      throw new Error(`Failed to send the ${kind} email`, { cause: error });
    }
    this.logger.log(`Sent the ${kind} email to ${maskEmail(email)}`);
  }
}
