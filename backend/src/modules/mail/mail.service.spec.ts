import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer');

describe('MailService', () => {
  const sendMail = jest.fn();
  let service: MailService;
  let config: jest.Mocked<ConfigService>;

  beforeEach(() => {
    sendMail.mockReset();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const values: Record<string, unknown> = {
          SMTP_HOST: 'smtp.test',
          SMTP_PORT: 587,
          SMTP_USER: 'user',
          SMTP_PASS: 'pass',
          SMTP_FROM: 'noreply@test',
        };
        return values[key] ?? fallback;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new MailService(config);
  });

  it('configures the transporter from config', () => {
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test',
      port: 587,
      secure: false,
      auth: { user: 'user', pass: 'pass' },
    });
  });

  describe('sendVerificationOtp', () => {
    it('sends a verification email', async () => {
      sendMail.mockResolvedValue(undefined);
      await service.sendVerificationOtp('a@b.com', '123456');
      expect(sendMail).toHaveBeenCalledTimes(1);
      const opts = sendMail.mock.calls[0][0];
      expect(opts.to).toBe('a@b.com');
      expect(opts.subject).toMatch(/verify/i);
      expect(opts.html).toContain('123456');
    });

    it('throws when transport fails', async () => {
      sendMail.mockRejectedValue(new Error('boom'));
      await expect(
        service.sendVerificationOtp('a@b.com', '111111'),
      ).rejects.toThrow('Failed to send verification email');
    });
  });

  describe('sendPasswordResetOtp', () => {
    it('sends a password reset email', async () => {
      sendMail.mockResolvedValue(undefined);
      await service.sendPasswordResetOtp('a@b.com', '654321');
      const opts = sendMail.mock.calls[0][0];
      expect(opts.subject).toMatch(/reset/i);
      expect(opts.html).toContain('654321');
    });

    it('throws when transport fails', async () => {
      sendMail.mockRejectedValue(new Error('boom'));
      await expect(
        service.sendPasswordResetOtp('a@b.com', '111111'),
      ).rejects.toThrow('Failed to send password reset email');
    });
  });

  describe('sendOtpEmail', () => {
    it('sends a generic OTP email', async () => {
      sendMail.mockResolvedValue(undefined);
      await service.sendOtpEmail('a@b.com', '999999');
      const opts = sendMail.mock.calls[0][0];
      expect(opts.subject).toMatch(/otp/i);
      expect(opts.html).toContain('999999');
    });

    it('throws when transport fails', async () => {
      sendMail.mockRejectedValue(new Error('boom'));
      await expect(service.sendOtpEmail('a@b.com', '111111')).rejects.toThrow(
        'Failed to send OTP email',
      );
    });
  });
});
