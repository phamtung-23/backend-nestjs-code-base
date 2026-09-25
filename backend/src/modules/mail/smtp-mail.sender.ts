import { Inject, Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MailConfig, mailConfig } from '../../config/mail.config';
import { MailMessage, MailSender } from './interfaces/mail-sender.interface';

// Port 465 speaks TLS from the start; other ports upgrade with STARTTLS
const IMPLICIT_TLS_PORT = 465;

@Injectable()
export class SmtpMailSender implements MailSender {
  private readonly transporter: nodemailer.Transporter;

  constructor(@Inject(mailConfig.KEY) private readonly config: MailConfig) {
    const implicitTls = config.port === IMPLICIT_TLS_PORT;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: implicitTls,
      // With credentials, refuse to go on without STARTTLS: otherwise a
      // man-in-the-middle that hides it gets the password and every code
      requireTLS: !implicitTls && Boolean(config.user),
      // Local catchers (Mailpit) need no credentials and no TLS
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.config.from, ...message });
  }
}
