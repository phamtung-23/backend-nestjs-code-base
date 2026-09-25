import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer');

describe('MailService', () => {
  const sendMail = jest.fn();
  let service: MailService;
  let config: jest.Mocked<ConfigService>;
  let loggerError: jest.SpyInstance;
  let loggerLog: jest.SpyInstance;

  beforeEach(() => {
    sendMail.mockReset();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    loggerLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

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

  afterEach(() => {
    loggerError.mockRestore();
    loggerLog.mockRestore();
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
    it('sends a verification email with the code and its expiry', async () => {
      sendMail.mockResolvedValue(undefined);

      await service.sendVerificationOtp('a@b.com', '123456', 7);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const opts = sendMail.mock.calls[0][0];
      expect(opts.from).toBe('noreply@test');
      expect(opts.to).toBe('a@b.com');
      expect(opts.subject).toMatch(/verify/i);
      expect(opts.html).toContain('123456');
      expect(opts.html).toContain('expire in 7 minutes');
    });

    it('throws when transport fails', async () => {
      sendMail.mockRejectedValue(new Error('boom'));

      await expect(
        service.sendVerificationOtp('a@b.com', '111111', 10),
      ).rejects.toThrow('Failed to send verification email');
      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendPasswordResetOtp', () => {
    it('sends a password reset email with the code and its expiry', async () => {
      sendMail.mockResolvedValue(undefined);

      await service.sendPasswordResetOtp('a@b.com', '654321', 12);

      const opts = sendMail.mock.calls[0][0];
      expect(opts.from).toBe('noreply@test');
      expect(opts.to).toBe('a@b.com');
      expect(opts.subject).toMatch(/reset/i);
      expect(opts.html).toContain('654321');
      expect(opts.html).toContain('expire in 12 minutes');
    });

    it('throws when transport fails', async () => {
      sendMail.mockRejectedValue(new Error('boom'));

      await expect(
        service.sendPasswordResetOtp('a@b.com', '111111', 10),
      ).rejects.toThrow('Failed to send password reset email');
      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendOtpEmail', () => {
    it('sends a login code email with the code and its expiry', async () => {
      sendMail.mockResolvedValue(undefined);

      await service.sendOtpEmail('a@b.com', '999999', 5);

      const opts = sendMail.mock.calls[0][0];
      expect(opts.from).toBe('noreply@test');
      expect(opts.to).toBe('a@b.com');
      expect(opts.subject).toMatch(/otp/i);
      expect(opts.html).toContain('999999');
      expect(opts.html).toContain('expire in 5 minutes');
    });

    it('throws when transport fails', async () => {
      sendMail.mockRejectedValue(new Error('boom'));

      await expect(
        service.sendOtpEmail('a@b.com', '111111', 10),
      ).rejects.toThrow('Failed to send OTP email');
      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });
});
