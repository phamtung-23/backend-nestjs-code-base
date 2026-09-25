import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, RefreshToken, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { AuthErrorCode } from './auth.constants';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService } from './token.service';

const NOW = new Date('2026-09-25T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
// exp claim of the signed refresh token, in seconds
const REFRESH_EXP = Math.floor(NOW.getTime() / 1000) + 7 * 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const buildUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
  id: 'user-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  avatar: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  isEmailVerified: true,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const buildStoredToken = (
  overrides: Partial<RefreshToken> = {},
): RefreshToken => ({
  id: 'rt-1',
  tokenHash: sha256('old-refresh-token'),
  // Deprecated plaintext column, kept only for rollback; always null here
  token: null,
  userId: 'user-1',
  expiresAt: new Date(NOW.getTime() + DAY_MS),
  isRevoked: false,
  userAgent: null,
  ipAddress: null,
  createdAt: NOW,
  ...overrides,
});

const buildConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new TypeError(`Configuration key "${key}" does not exist`);
      }
      return value;
    }),
  }) as unknown as ConfigService;

async function expectHttpError(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  errorCode: string,
): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('Expected the call to reject');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ errorCode });
}

const CONFIG: Record<string, string | undefined> = {
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_ACCESS_EXPIRES_IN: '30m',
  JWT_REFRESH_EXPIRES_IN: '14d',
};

describe('TokenService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;
  const client: ClientMeta = { userAgent: 'jest', ipAddress: '203.0.113.7' };

  let prisma: { $transaction: jest.Mock };
  let jwtService: jest.Mocked<JwtService>;
  let repository: jest.Mocked<RefreshTokenRepository>;
  let usersService: jest.Mocked<UsersService>;
  let config: ConfigService;
  let service: TokenService;

  const createService = () =>
    new TokenService(
      prisma as unknown as PrismaService,
      jwtService,
      repository,
      usersService,
      config,
    );

  const refreshSignCall = () =>
    jwtService.sign.mock.calls.find(
      ([payload]) => (payload as { type?: string }).type === 'refresh',
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });

    prisma = {
      $transaction: jest.fn(
        (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    jwtService = {
      sign: jest.fn((payload: { type?: string }) =>
        payload.type === 'refresh' ? 'refresh-token' : 'access-token',
      ),
      decode: jest.fn().mockReturnValue({ exp: REFRESH_EXP }),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    repository = {
      create: jest.fn().mockResolvedValue({}),
      findByHash: jest.fn(),
      revokeIfActive: jest.fn(),
      revokeByHash: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn(),
      deleteStale: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokenRepository>;

    usersService = {
      lockForUpdate: jest.fn().mockResolvedValue(true),
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    config = buildConfig(CONFIG);

    service = createService();
  });

  afterEach(() => jest.useRealTimers());

  describe('configuration', () => {
    it.each(Object.keys(CONFIG))(
      'fails fast when %s is not configured',
      (missing) => {
        config = buildConfig({ ...CONFIG, [missing]: undefined });

        expect(() => createService()).toThrow(missing);
      },
    );

    it('uses the configured secret and lifetimes', async () => {
      await service.issue(buildUser(), client);

      expect(jwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '30m',
      });
      expect(refreshSignCall()?.[1]).toEqual({
        secret: 'refresh-secret',
        expiresIn: '14d',
      });
    });
  });

  describe('issue', () => {
    it('signs the access token with the default secret and the configured lifetime', async () => {
      await service.issue(buildUser(), client, tx);

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'jane@example.com', role: UserRole.CUSTOMER },
        { expiresIn: '30m' },
      );
    });

    it('signs the refresh token with the refresh secret, its lifetime and a random jti', async () => {
      await service.issue(buildUser(), client, tx);

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'user-1',
          type: 'refresh',
          jti: expect.stringMatching(UUID_PATTERN),
        },
        { secret: 'refresh-secret', expiresIn: '14d' },
      );
    });

    it('gives every refresh token a different jti', async () => {
      await service.issue(buildUser(), client);
      await service.issue(buildUser(), client);

      const jtis = jwtService.sign.mock.calls
        .map(([payload]) => (payload as { jti?: string }).jti)
        .filter(Boolean);
      expect(jtis).toHaveLength(2);
      expect(jtis[0]).not.toBe(jtis[1]);
    });

    it('stores only the sha256 hash of the refresh token, with its expiry and client, in the given transaction', async () => {
      await service.issue(buildUser(), client, tx);

      expect(jwtService.decode).toHaveBeenCalledWith('refresh-token');
      expect(repository.create).toHaveBeenCalledWith(
        {
          tokenHash: sha256('refresh-token'),
          userId: 'user-1',
          expiresAt: new Date(REFRESH_EXP * 1000),
          userAgent: 'jest',
          ipAddress: '203.0.113.7',
        },
        tx,
      );
      expect(JSON.stringify(repository.create.mock.calls)).not.toContain(
        'refresh-token',
      );
    });

    it('returns the raw token pair to the caller', async () => {
      await expect(service.issue(buildUser(), client, tx)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });
  });

  describe('rotate', () => {
    beforeEach(() => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', type: 'refresh' });
      repository.findByHash.mockResolvedValue(buildStoredToken());
      usersService.findById.mockResolvedValue(buildUser());
      repository.revokeIfActive.mockResolvedValue(true);
    });

    it('locks the user, re-reads it and swaps the old token for a new pair inside one transaction', async () => {
      const result = await service.rotate('old-refresh-token', client);

      expect(jwtService.verify).toHaveBeenCalledWith('old-refresh-token', {
        secret: 'refresh-secret',
      });
      expect(repository.findByHash).toHaveBeenCalledWith(
        sha256('old-refresh-token'),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(usersService.findById).toHaveBeenCalledWith('user-1', tx);
      expect(repository.revokeIfActive).toHaveBeenCalledWith('rt-1', tx);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: sha256('refresh-token'),
          userId: 'user-1',
        }),
        tx,
      );
      const lockedAt = usersService.lockForUpdate.mock.invocationCallOrder[0];
      for (const next of [
        usersService.findById,
        repository.revokeIfActive,
        repository.create,
      ]) {
        expect(lockedAt).toBeLessThan(next.mock.invocationCallOrder[0]);
      }
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });

    it('returns 401 AUTH_INVALID_REFRESH_TOKEN when the JWT does not verify', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expectHttpError(
        service.rotate('old-refresh-token', client),
        UnauthorizedException,
        AuthErrorCode.INVALID_REFRESH_TOKEN,
      );
      expect(repository.findByHash).not.toHaveBeenCalled();
    });

    it('returns 401 AUTH_INVALID_REFRESH_TOKEN for a token that is not a refresh token', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });

      await expectHttpError(
        service.rotate('old-refresh-token', client),
        UnauthorizedException,
        AuthErrorCode.INVALID_REFRESH_TOKEN,
      );
      expect(repository.findByHash).not.toHaveBeenCalled();
    });

    it.each<[string, RefreshToken | null]>([
      ['the token is not stored', null],
      ['the token was revoked', buildStoredToken({ isRevoked: true })],
      [
        'the token has expired',
        buildStoredToken({ expiresAt: new Date(NOW.getTime() - 1) }),
      ],
      [
        'the token belongs to another user',
        buildStoredToken({ userId: 'user-2' }),
      ],
    ])(
      'returns 401 AUTH_INVALID_REFRESH_TOKEN when %s',
      async (_case, stored) => {
        repository.findByHash.mockResolvedValue(stored);

        await expectHttpError(
          service.rotate('old-refresh-token', client),
          UnauthorizedException,
          AuthErrorCode.INVALID_REFRESH_TOKEN,
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(usersService.lockForUpdate).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
      },
    );

    it.each<[string, PublicUser | null]>([
      ['the user no longer exists', null],
      ['the user is disabled', buildUser({ isActive: false })],
    ])(
      'returns 401 AUTH_INVALID_REFRESH_TOKEN and keeps the old token when %s',
      async (_case, user) => {
        usersService.findById.mockResolvedValue(user);

        await expectHttpError(
          service.rotate('old-refresh-token', client),
          UnauthorizedException,
          AuthErrorCode.INVALID_REFRESH_TOKEN,
        );
        expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
        expect(repository.revokeIfActive).not.toHaveBeenCalled();
        expect(jwtService.sign).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
        await expect(
          prisma.$transaction.mock.results[0].value,
        ).resolves.toBeNull();
      },
    );

    it('returns 401 AUTH_INVALID_REFRESH_TOKEN without issuing tokens when a concurrent refresh already rotated it', async () => {
      repository.revokeIfActive.mockResolvedValue(false);

      await expectHttpError(
        service.rotate('old-refresh-token', client),
        UnauthorizedException,
        AuthErrorCode.INVALID_REFRESH_TOKEN,
      );
      expect(repository.revokeIfActive).toHaveBeenCalledWith('rt-1', tx);
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      await expect(
        prisma.$transaction.mock.results[0].value,
      ).resolves.toBeNull();
    });
  });

  describe('revoke', () => {
    it('revokes by the hash of the token, never the raw token', async () => {
      await expect(service.revoke('refresh-token')).resolves.toBeUndefined();

      expect(repository.revokeByHash).toHaveBeenCalledWith(
        sha256('refresh-token'),
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active token of the user in the given transaction and returns the count', async () => {
      repository.revokeAllForUser.mockResolvedValue(2);

      await expect(service.revokeAllForUser('user-1', tx)).resolves.toBe(2);
      expect(repository.revokeAllForUser).toHaveBeenCalledWith('user-1', tx);
    });
  });

  describe('cleanup', () => {
    it('deletes stale tokens, keeping revoked ones for 30 days, and returns the count', async () => {
      repository.deleteStale.mockResolvedValue(4);

      await expect(service.cleanup()).resolves.toBe(4);
      expect(repository.deleteStale).toHaveBeenCalledWith(
        new Date(NOW.getTime() - 30 * DAY_MS),
      );
    });
  });
});
