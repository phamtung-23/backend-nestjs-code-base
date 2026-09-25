import { Logger } from '@nestjs/common';
import { MailSender } from './interfaces/mail-sender.interface';
import { MailService } from './mail.service';

describe('MailService', () => {
  let sender: { send: jest.Mock };
  let loggerError: jest.SpyInstance;
  let loggerLog: jest.SpyInstance;
  let service: MailService;

  beforeEach(() => {
    sender = { send: jest.fn().mockResolvedValue(undefined) };
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    loggerLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    service = new MailService(sender as MailSender);
  });

  afterEach(() => {
    loggerError.mockRestore();
    loggerLog.mockRestore();
  });

  describe.each([
    ['sendVerificationOtp', /verify your email/i, 'verification'],
    ['sendPasswordResetOtp', /reset your password/i, 'passwordReset'],
    ['sendLoginOtp', /login code/i, 'login'],
  ] as const)('%s', (method, subject, kind) => {
    it('sends the code and its expiry through the MailSender', async () => {
      await service[method]('jane.doe@example.com', '123456', 7);

      expect(sender.send).toHaveBeenCalledTimes(1);
      const message = sender.send.mock.calls[0][0];
      expect(message.to).toBe('jane.doe@example.com');
      expect(message.subject).toMatch(subject);
      expect(message.html).toContain('123456');
      expect(message.text).toContain('123456');
      expect(message.text).toContain('expire in 7 minutes');
    });

    it('logs the recipient masked, never in full', async () => {
      await service[method]('jane.doe@example.com', '123456', 7);

      expect(loggerLog).toHaveBeenCalledWith(
        `Sent the ${kind} email to ja***@example.com`,
      );
      expect(JSON.stringify(loggerLog.mock.calls)).not.toContain('jane.doe');
      expect(JSON.stringify(loggerLog.mock.calls)).not.toContain('123456');
    });

    it('logs and rethrows when the transport fails, keeping the cause', async () => {
      const cause = new Error('SMTP down');
      sender.send.mockRejectedValue(cause);

      const error = await service[method]('jane.doe@example.com', '123456', 7)
        .then(() => {
          throw new Error('Expected the call to reject');
        })
        .catch((thrown: unknown) => thrown as Error);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(`Failed to send the ${kind} email`);
      expect(error.cause).toBe(cause);
      expect(loggerError).toHaveBeenCalledWith(
        `Failed to send the ${kind} email to ja***@example.com`,
        cause.stack,
      );
    });
  });

  it('masks addresses that the transport error echoes (SMTP replies do)', async () => {
    const error = new Error(
      "Can't send mail - all recipients were rejected: 550 5.1.1 <jane.doe@example.com>: Recipient address rejected",
    );
    sender.send.mockRejectedValue(error);

    await expect(
      service.sendLoginOtp('jane.doe@example.com', '123456', 7),
    ).rejects.toThrow();
    const logged = JSON.stringify(loggerError.mock.calls);
    expect(logged).not.toContain('jane.doe@example.com');
    expect(logged).toContain('<ja***@example.com>');
  });

  it('logs the message when an Error has no stack', async () => {
    const error = new Error('550 <jane.doe@example.com> rejected');
    error.stack = undefined;
    sender.send.mockRejectedValue(error);

    await expect(
      service.sendLoginOtp('jane.doe@example.com', '123456', 7),
    ).rejects.toThrow();
    expect(loggerError).toHaveBeenCalledWith(
      expect.any(String),
      '550 <ja***@example.com> rejected',
    );
  });

  it('logs transport failures that are not Error instances as strings', async () => {
    sender.send.mockRejectedValue('timeout');

    await expect(
      service.sendLoginOtp('jane@example.com', '123456', 7),
    ).rejects.toThrow();
    expect(loggerError).toHaveBeenCalledWith(expect.any(String), 'timeout');
  });
});
