import { Logger } from '@nestjs/common';
import { OtpType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CodeDeliveryService } from './code-delivery.service';
import {
  AuthMocks,
  buildUser,
  createAuthMocks,
  expectLockedBefore,
  flushBackgroundWork,
  tx,
} from './testing/auth.fixtures';

describe('CodeDeliveryService', () => {
  let prisma: AuthMocks['prisma'];
  let usersService: AuthMocks['usersService'];
  let otpService: AuthMocks['otpService'];
  let mailService: AuthMocks['mailService'];
  let loggerError: jest.SpyInstance;
  let service: CodeDeliveryService;

  beforeEach(() => {
    ({ prisma, usersService, otpService, mailService } = createAuthMocks());
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new CodeDeliveryService(
      prisma as unknown as PrismaService,
      usersService,
      otpService,
      mailService,
    );
  });

  afterEach(() => loggerError.mockRestore());

  describe.each([
    { type: OtpType.VERIFICATION, mail: 'sendVerificationOtp' },
    { type: OtpType.PASSWORD_RESET, mail: 'sendPasswordResetOtp' },
    { type: OtpType.LOGIN, mail: 'sendLoginOtp' },
  ] as const)('sendInBackground ($type)', ({ type, mail }) => {
    const isEligible = jest.fn(() => true);
    const send = () =>
      service.sendInBackground('jane@example.com', type, isEligible);

    beforeEach(() => {
      isEligible.mockClear().mockReturnValue(true);
      usersService.findByEmail.mockResolvedValue(buildUser());
    });

    it('locks the user and issues the code in one transaction, then emails it with the configured expiry', async () => {
      expect(send()).toBeUndefined();
      await flushBackgroundWork();

      expect(usersService.findByEmail).toHaveBeenCalledWith('jane@example.com');
      expect(isEligible).toHaveBeenCalledWith(buildUser());
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(otpService.issue).toHaveBeenCalledWith('user-1', type, tx);
      expectLockedBefore(usersService, otpService.issue);
      expect(mailService[mail]).toHaveBeenCalledWith(
        'jane@example.com',
        '123456',
        15,
      );
    });

    it('does nothing for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      send();
      await flushBackgroundWork();
      expect(isEligible).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('does nothing for an account the flow does not serve', async () => {
      isEligible.mockReturnValue(false);

      send();
      await flushBackgroundWork();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('sends no email while issuing is rate limited', async () => {
      otpService.issue.mockResolvedValue(null);

      send();
      await flushBackgroundWork();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('issues nothing when the account disappears before the lock', async () => {
      usersService.lockForUpdate.mockResolvedValue(false);

      send();
      await flushBackgroundWork();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('responds before the account is even looked up (timing reveals nothing)', () => {
      usersService.findByEmail.mockReturnValue(new Promise(() => {}));

      expect(send()).toBeUndefined();
      expect(otpService.issue).not.toHaveBeenCalled();
    });

    it('logs failures instead of failing the request', async () => {
      const error = new Error('SMTP down');
      mailService[mail].mockRejectedValue(error);

      expect(send()).toBeUndefined();
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        error.stack,
      );
    });
  });

  describe('deliverInBackground', () => {
    it('emails an already issued code without issuing another', async () => {
      service.deliverInBackground(
        'jane@example.com',
        OtpType.VERIFICATION,
        '654321',
      );
      await flushBackgroundWork();

      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService.sendVerificationOtp).toHaveBeenCalledWith(
        'jane@example.com',
        '654321',
        15,
      );
    });

    it('returns without waiting for the email to be delivered', () => {
      mailService.sendVerificationOtp.mockReturnValue(new Promise(() => {}));

      expect(
        service.deliverInBackground(
          'jane@example.com',
          OtpType.VERIFICATION,
          '654321',
        ),
      ).toBeUndefined();
    });

    it('logs a delivery failure, including non-Error rejections', async () => {
      mailService.sendVerificationOtp.mockRejectedValue('SMTP down');

      service.deliverInBackground(
        'jane@example.com',
        OtpType.VERIFICATION,
        '654321',
      );
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        'SMTP down',
      );
    });
  });
});
