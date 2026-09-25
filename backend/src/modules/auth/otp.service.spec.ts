import { Otp, OtpType, Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  OTP_ISSUE_WINDOW_MS,
  OTP_MAX_ISSUED_PER_WINDOW,
  OTP_RESEND_COOLDOWN_MS,
} from './auth.constants';
import { AuthConfig } from '../../config/auth.config';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';

// Pass-through spy so the range and source of the random code can be checked
jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

const NOW = new Date('2026-09-25T10:00:00.000Z');
const MINUTE_MS = 60 * 1000;

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const buildOtp = (overrides: Partial<Otp> = {}): Otp => ({
  id: 'otp-1',
  code: '123456',
  expiresAt: new Date(NOW.getTime() + 10 * MINUTE_MS),
  isUsed: false,
  attempts: 0,
  type: OtpType.LOGIN,
  createdAt: NOW,
  userId: 'user-1',
  ...overrides,
});

const CONFIG: AuthConfig = {
  jwtSecret: 'access-secret',
  jwtRefreshSecret: 'refresh-secret',
  accessTokenTtl: '30m',
  refreshTokenTtl: '14d',
  otpMaxAttempts: 3,
  otpExpiryMinutes: 15,
};

describe('OtpService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;

  let repository: jest.Mocked<OtpRepository>;
  let service: OtpService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    (crypto.randomInt as unknown as jest.Mock).mockClear();

    repository = {
      create: jest.fn().mockResolvedValue(buildOtp()),
      findLatestActive: jest.fn(),
      registerAttempt: jest.fn(),
      markUsed: jest.fn(),
      invalidateActive: jest.fn().mockResolvedValue(undefined),
      findIssuedSince: jest.fn().mockResolvedValue([]),
      deleteStale: jest.fn(),
    } as unknown as jest.Mocked<OtpRepository>;

    service = new OtpService(repository, CONFIG);
  });

  afterEach(() => jest.useRealTimers());

  describe('configuration', () => {
    it('exposes the configured expiry for the emails', () => {
      expect(service.expiryMinutes).toBe(15);
    });
  });

  describe('issue', () => {
    it('invalidates older codes of the same type, then stores a 6-digit code that expires after the configured minutes', async () => {
      const code = await service.issue('user-1', OtpType.VERIFICATION, tx);

      expect(code).toMatch(/^\d{6}$/);
      expect(repository.invalidateActive).toHaveBeenCalledWith(
        'user-1',
        OtpType.VERIFICATION,
        tx,
      );
      expect(repository.create).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          type: OtpType.VERIFICATION,
          code,
          expiresAt: new Date(NOW.getTime() + 15 * MINUTE_MS),
        },
        tx,
      );
      expect(
        repository.invalidateActive.mock.invocationCallOrder[0],
      ).toBeLessThan(repository.create.mock.invocationCallOrder[0]);
    });

    it('checks the codes issued in the last hour within the same transaction', async () => {
      await service.issue('user-1', OtpType.LOGIN, tx);

      expect(repository.findIssuedSince).toHaveBeenCalledWith(
        'user-1',
        OtpType.LOGIN,
        ago(OTP_ISSUE_WINDOW_MS),
        tx,
      );
      expect(
        repository.findIssuedSince.mock.invocationCallOrder[0],
      ).toBeLessThan(repository.invalidateActive.mock.invocationCallOrder[0]);
    });

    it('draws the code from the full 6-digit range with a CSPRNG', async () => {
      await service.issue('user-1', OtpType.LOGIN, tx);

      expect(crypto.randomInt).toHaveBeenCalledWith(100000, 1000000);
    });

    it('returns null during the resend cooldown without touching the current code', async () => {
      repository.findIssuedSince.mockResolvedValue([
        ago(OTP_RESEND_COOLDOWN_MS - 1),
      ]);

      await expect(service.issue('user-1', OtpType.LOGIN, tx)).resolves.toBe(
        null,
      );
      expect(repository.invalidateActive).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('issues again once the cooldown has fully passed', async () => {
      repository.findIssuedSince.mockResolvedValue([
        ago(OTP_RESEND_COOLDOWN_MS),
      ]);

      await expect(service.issue('user-1', OtpType.LOGIN, tx)).resolves.toMatch(
        /^\d{6}$/,
      );
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('returns null once the hourly cap of codes has been issued', async () => {
      // Newest first, all outside the cooldown
      const issued = Array.from({ length: OTP_MAX_ISSUED_PER_WINDOW }, (_, i) =>
        ago((i + 2) * MINUTE_MS),
      );
      repository.findIssuedSince.mockResolvedValue(issued);

      await expect(service.issue('user-1', OtpType.LOGIN, tx)).resolves.toBe(
        null,
      );
      expect(repository.invalidateActive).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('still issues the last code allowed under the hourly cap', async () => {
      const issued = Array.from(
        { length: OTP_MAX_ISSUED_PER_WINDOW - 1 },
        (_, i) => ago((i + 2) * MINUTE_MS),
      );
      repository.findIssuedSince.mockResolvedValue(issued);

      await expect(service.issue('user-1', OtpType.LOGIN, tx)).resolves.toMatch(
        /^\d{6}$/,
      );
    });
  });

  describe('consume', () => {
    it('returns false when there is no active code', async () => {
      repository.findLatestActive.mockResolvedValue(null);

      await expect(
        service.consume('user-1', OtpType.LOGIN, '123456', tx),
      ).resolves.toBe(false);
      expect(repository.findLatestActive).toHaveBeenCalledWith(
        'user-1',
        OtpType.LOGIN,
        tx,
      );
      expect(repository.registerAttempt).not.toHaveBeenCalled();
      expect(repository.markUsed).not.toHaveBeenCalled();
    });

    it('returns false without consuming the code once the attempt limit is reached, even for the right code', async () => {
      repository.findLatestActive.mockResolvedValue(buildOtp());
      repository.registerAttempt.mockResolvedValue(false);

      await expect(
        service.consume('user-1', OtpType.LOGIN, '123456', tx),
      ).resolves.toBe(false);
      expect(repository.registerAttempt).toHaveBeenCalledWith('otp-1', 3, tx);
      expect(repository.markUsed).not.toHaveBeenCalled();
    });

    it('counts a wrong code as an attempt and returns false', async () => {
      repository.findLatestActive.mockResolvedValue(buildOtp());
      repository.registerAttempt.mockResolvedValue(true);

      await expect(
        service.consume('user-1', OtpType.LOGIN, '000000', tx),
      ).resolves.toBe(false);
      expect(repository.registerAttempt).toHaveBeenCalledWith('otp-1', 3, tx);
      expect(repository.markUsed).not.toHaveBeenCalled();
    });

    it.each(['12345', '1234567', ''])(
      'rejects the code "%s" of a different length without throwing',
      async (guess) => {
        repository.findLatestActive.mockResolvedValue(buildOtp());
        repository.registerAttempt.mockResolvedValue(true);

        await expect(
          service.consume('user-1', OtpType.LOGIN, guess, tx),
        ).resolves.toBe(false);
        expect(repository.markUsed).not.toHaveBeenCalled();
      },
    );

    it('marks the right code used and returns true', async () => {
      repository.findLatestActive.mockResolvedValue(buildOtp());
      repository.registerAttempt.mockResolvedValue(true);
      repository.markUsed.mockResolvedValue(true);

      await expect(
        service.consume('user-1', OtpType.LOGIN, '123456', tx),
      ).resolves.toBe(true);
      expect(repository.markUsed).toHaveBeenCalledWith('otp-1', tx);
    });

    it('returns false when a concurrent request consumed the code first', async () => {
      repository.findLatestActive.mockResolvedValue(buildOtp());
      repository.registerAttempt.mockResolvedValue(true);
      repository.markUsed.mockResolvedValue(false);

      await expect(
        service.consume('user-1', OtpType.LOGIN, '123456', tx),
      ).resolves.toBe(false);
    });
  });

  describe('cleanup', () => {
    it('deletes stale codes, keeping used ones for a day, and returns the count', async () => {
      repository.deleteStale.mockResolvedValue(7);

      await expect(service.cleanup()).resolves.toBe(7);
      expect(repository.deleteStale).toHaveBeenCalledWith(
        ago(24 * 60 * MINUTE_MS),
      );
    });
  });
});
