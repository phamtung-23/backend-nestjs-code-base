import { Module } from '@nestjs/common';
import { MAIL_SENDER } from './mail.constants';
import { MailService } from './mail.service';
import { SmtpMailSender } from './smtp-mail.sender';

@Module({
  providers: [MailService, { provide: MAIL_SENDER, useClass: SmtpMailSender }],
  exports: [MailService],
})
export class MailModule {}
