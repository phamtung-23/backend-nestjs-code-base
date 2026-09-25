import * as nodemailer from 'nodemailer';
import { MailConfig } from '../../config/mail.config';
import { SmtpMailSender } from './smtp-mail.sender';

jest.mock('nodemailer');

describe('SmtpMailSender', () => {
  const sendMail = jest.fn();
  const config: MailConfig = {
    host: 'smtp.example.com',
    port: 587,
    user: 'mailer',
    pass: 'secret',
    from: 'noreply@example.com',
  };

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue(undefined);
    (nodemailer.createTransport as jest.Mock)
      .mockReset()
      .mockReturnValue({ sendMail });
  });

  it('requires STARTTLS before sending credentials from the mail config', () => {
    new SmtpMailSender(config);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'mailer', pass: 'secret' },
    });
  });

  it('uses implicit TLS on port 465', () => {
    new SmtpMailSender({ ...config, port: 465 });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false }),
    );
  });

  it('skips authentication and TLS when no user is configured (local mail catchers)', () => {
    new SmtpMailSender({ ...config, user: undefined, pass: undefined });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined, requireTLS: false }),
    );
  });

  it('sends the message from the configured sender', async () => {
    const message = {
      to: 'jane@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    };

    await new SmtpMailSender(config).send(message);

    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      ...message,
    });
  });

  it('lets transport errors propagate', async () => {
    sendMail.mockRejectedValue(new Error('connection refused'));

    await expect(
      new SmtpMailSender(config).send({
        to: 'a@example.com',
        subject: 's',
        html: 'h',
        text: 't',
      }),
    ).rejects.toThrow('connection refused');
  });
});
