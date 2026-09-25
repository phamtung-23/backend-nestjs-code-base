import { HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, RefreshToken, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { AuthErrorCode, REFRESH_REUSE_GRACE_MS } from './auth.constants';
import { AuthConfig } from '../../config/auth.config';
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

const ago = (ms: number) => new Date(NOW.getTime() - ms);

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
  familyId: 'family-1',
  userId: 'user-1',
  expiresAt: new Date(NOW.getTime() + DAY_MS),
  isRevoked: false,
  revokedAt: null,
  userAgent: null,
  ipAddress: null,
  createdAt: NOW,
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

describe('TokenService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;
  const client: ClientMeta = { userAgent: 'jest', ipAddress: '203.0.113.7' };

  let prisma: { $transaction: jest.Mock };
  let jwtService: jest.Mocked<JwtService>;
  let repository: jest.Mocked<RefreshTokenRepository>;
  let usersService: jest.Mocked<UsersService>;
  let auditService: jest.Mocked<AuditService>;
  let loggerWarn: jest.SpyInstance;
  let service: TokenService;

  const createService = () =>
    new TokenService(
      prisma as unknown as PrismaService,
      jwtService,
      repository,
      usersService,
      auditService,
      CONFIG,
    );

  const refreshSignCall = () =>
    jwtService.sign.mock.calls.find(
      ([payload]) => (payload as { type?: string }).type === 'refresh',
    );

  // The user row lock must be taken before each of the given calls
  const expectLockedBefore = (
    ...calls: jest.MockInstance<unknown, any[]>[]
  ) => {
    expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
    const lockedAt = usersService.lockForUpdate.mock.invocationCallOrder[0];
    for (const call of calls) {
      expect(call).toHaveBeenCalled();
      expect(lockedAt).toBeLessThan(call.mock.invocationCallOrder[0]);
    }
  };

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
      revokeFamily: jest.fn().mockResolvedValue(0),
      revokeAllForUser: jest.fn(),
      deleteStale: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokenRepository>;

    usersService = {
      lockForUpdate: jest.fn().mockResolvedValue(true),
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    service = createService();
  });

  afterEach(() => {
    loggerWarn.mockRestore();
    jest.useRealTimers();
  });

  describe('configuration', () => {
    it('uses the configured secret and lifetimes', async () => {
      await service.startSession(buildUser(), client, tx, 'password');

      expect(jwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '30m',
      });
      expect(refreshSignCall()?.[1]).toEqual({
        secret: 'refresh-secret',
        expiresIn: '14d',
      });
    });
  });

  describe('startSession', () => {
    it('issues a pair in a new family and audits the session start in the same transaction', async () => {
      const result = await service.startSession(
        buildUser(),
        client,
        tx,
        'code',
      );

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      const familyId = repository.create.mock.calls[0][0].familyId;
      expect(familyId).toMatch(UUID_PATTERN);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId, userId: 'user-1' }),
        tx,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.SESSION_STARTED,
          entity: AuditEntity.SESSION,
          entityId: familyId,
          actorId: 'user-1',
          metadata: { method: 'code' },
        },
        tx,
      );
      // Audited only once the token row exists
      expect(repository.create.mock.invocationCallOrder[0]).toBeLessThan(
        auditService.log.mock.invocationCallOrder[0],
      );
    });

    it('starts a new family every time', async () => {
      await service.startSession(buildUser(), client, tx, 'password');
      await service.startSession(buildUser(), client, tx, 'password');

      const [first, second] = repository.create.mock.calls.map(
        (call) => call[0].familyId,
      );
      expect(first).not.toBe(second);
    });

    it('fails, rolling the session back with the transaction, when the audit entry cannot be written', async () => {
      const error = new Error('audit insert failed');
      auditService.log.mockRejectedValue(error);

      await expect(
        service.startSession(buildUser(), client, tx, 'password'),
      ).rejects.toBe(error);
    });
  });

  describe('issued pair (startSession)', () => {
    it('signs the access token with the default secret and the configured lifetime', async () => {
      await service.startSession(buildUser(), client, tx, 'password');

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'jane@example.com', role: UserRole.CUSTOMER },
        { expiresIn: '30m' },
      );
    });

    it('signs the refresh token with the refresh secret, its lifetime and a random jti', async () => {
      await service.startSession(buildUser(), client, tx, 'password');

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
      await service.startSession(buildUser(), client, tx, 'password');
      await service.startSession(buildUser(), client, tx, 'password');

      const jtis = jwtService.sign.mock.calls
        .map(([payload]) => (payload as { jti?: string }).jti)
        .filter(Boolean);
      expect(jtis).toHaveLength(2);
      expect(jtis[0]).not.toBe(jtis[1]);
    });

    it('stores only the sha256 hash of the refresh token, with its family, expiry and client, in the given transaction', async () => {
      await service.startSession(buildUser(), client, tx, 'password');

      expect(jwtService.decode).toHaveBeenCalledWith('refresh-token');
      expect(repository.create).toHaveBeenCalledWith(
        {
          tokenHash: sha256('refresh-token'),
          familyId: expect.stringMatching(UUID_PATTERN),
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
      await expect(
        service.startSession(buildUser(), client, tx, 'password'),
      ).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });
  });

  describe('rotate', () => {
    const rotate = () => service.rotate('old-refresh-token', client);

    beforeEach(() => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', type: 'refresh' });
      repository.findByHash.mockResolvedValue(buildStoredToken());
      usersService.findById.mockResolvedValue(buildUser());
      repository.revokeIfActive.mockResolvedValue(true);
    });

    it('locks the user, re-reads it and swaps the old token for a new one of the same family inside one transaction', async () => {
      const result = await rotate();

      expect(jwtService.verify).toHaveBeenCalledWith('old-refresh-token', {
        secret: 'refresh-secret',
      });
      expect(repository.findByHash).toHaveBeenCalledWith(
        sha256('old-refresh-token'),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.findById).toHaveBeenCalledWith('user-1', tx);
      expect(repository.revokeIfActive).toHaveBeenCalledWith('rt-1', tx);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: sha256('refresh-token'),
          familyId: 'family-1',
          userId: 'user-1',
        }),
        tx,
      );
      expectLockedBefore(
        usersService.findById,
        repository.revokeIfActive,
        repository.create,
      );
      expect(repository.revokeFamily).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
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
        rotate(),
        UnauthorizedException,
        AuthErrorCode.INVALID_REFRESH_TOKEN,
      );
      expect(repository.findByHash).not.toHaveBeenCalled();
    });

    it('returns 401 AUTH_INVALID_REFRESH_TOKEN for a token that is not a refresh token', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });

      await expectHttpError(
        rotate(),
        UnauthorizedException,
        AuthErrorCode.INVALID_REFRESH_TOKEN,
      );
      expect(repository.findByHash).not.toHaveBeenCalled();
    });

    it.each<[string, RefreshToken | null]>([
      ['the token is not stored', null],
      [
        'the token belongs to another user',
        buildStoredToken({ userId: 'user-2', isRevoked: true }),
      ],
      [
        'the token has expired',
        buildStoredToken({ expiresAt: new Date(NOW.getTime() - 1) }),
      ],
    ])(
      'returns 401 AUTH_INVALID_REFRESH_TOKEN without touching any session when %s',
      async (_case, stored) => {
        repository.findByHash.mockResolvedValue(stored);

        await expectHttpError(
          rotate(),
          UnauthorizedException,
          AuthErrorCode.INVALID_REFRESH_TOKEN,
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(usersService.lockForUpdate).not.toHaveBeenCalled();
        expect(repository.revokeFamily).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
      },
    );

    describe('with a token that was already revoked', () => {
      const presentRevoked = (revokedAt: Date | null) => {
        repository.findByHash.mockResolvedValue(
          buildStoredToken({ isRevoked: true, revokedAt }),
        );
        return rotate();
      };

      it.each([
        ['just now', 0],
        ['1 second ago', 1000],
        ['exactly at the end of the grace window', REFRESH_REUSE_GRACE_MS],
      ])(
        'returns 401 without revoking anything when it was revoked %s (concurrent refresh)',
        async (_case, revokedFor) => {
          await expectHttpError(
            presentRevoked(ago(revokedFor)),
            UnauthorizedException,
            AuthErrorCode.INVALID_REFRESH_TOKEN,
          );
          expect(prisma.$transaction).not.toHaveBeenCalled();
          expect(repository.revokeFamily).not.toHaveBeenCalled();
          expect(loggerWarn).not.toHaveBeenCalled();
          expect(auditService.log).not.toHaveBeenCalled();
          expect(jwtService.sign).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['1 ms after the grace window', REFRESH_REUSE_GRACE_MS + 1],
        ['a day ago', DAY_MS],
      ])(
        'treats it as reuse when it was revoked %s: revokes the whole family under the user lock and returns 401',
        async (_case, revokedFor) => {
          repository.revokeFamily.mockResolvedValue(2);

          await expectHttpError(
            presentRevoked(ago(revokedFor)),
            UnauthorizedException,
            AuthErrorCode.INVALID_REFRESH_TOKEN,
          );
          expect(prisma.$transaction).toHaveBeenCalledTimes(1);
          expect(repository.revokeFamily).toHaveBeenCalledWith('family-1', tx);
          expect(auditService.log).toHaveBeenCalledWith(
            {
              action: AuditAction.SESSION_REUSE_DETECTED,
              entity: AuditEntity.SESSION,
              entityId: 'family-1',
              // Whoever presented the reused token isn't necessarily the owner
              actorId: null,
              metadata: { userId: 'user-1', revokedTokens: 2 },
            },
            tx,
          );
          expectLockedBefore(repository.revokeFamily, auditService.log);
          expect(repository.revokeIfActive).not.toHaveBeenCalled();
          expect(jwtService.sign).not.toHaveBeenCalled();
          expect(repository.create).not.toHaveBeenCalled();
        },
      );

      it('treats a revoked token without a revocation time as reuse', async () => {
        await expectHttpError(
          presentRevoked(null),
          UnauthorizedException,
          AuthErrorCode.INVALID_REFRESH_TOKEN,
        );
        expect(repository.revokeFamily).toHaveBeenCalledWith('family-1', tx);
      });

      it('warns about the reuse when it revoked live tokens of the family', async () => {
        repository.revokeFamily.mockResolvedValue(2);

        await expect(presentRevoked(ago(DAY_MS))).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(loggerWarn).toHaveBeenCalledTimes(1);
        expect(loggerWarn.mock.calls[0][0]).toContain('user-1');
        expect(loggerWarn.mock.calls[0][0]).toContain('2 token(s)');
        expect(loggerWarn.mock.calls[0][0]).not.toContain('old-refresh-token');
      });

      it('does not warn when the family had no live tokens left', async () => {
        repository.revokeFamily.mockResolvedValue(0);

        await expect(presentRevoked(ago(DAY_MS))).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(repository.revokeFamily).toHaveBeenCalledTimes(1);
        expect(loggerWarn).not.toHaveBeenCalled();
        expect(auditService.log).not.toHaveBeenCalled();
      });
    });

    it.each<[string, PublicUser | null]>([
      ['the user no longer exists', null],
      ['the user is disabled', buildUser({ isActive: false })],
    ])(
      'returns 401 AUTH_INVALID_REFRESH_TOKEN and keeps the old token when %s',
      async (_case, user) => {
        usersService.findById.mockResolvedValue(user);

        await expectHttpError(
          rotate(),
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
        rotate(),
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

  describe('revoke (logout)', () => {
    it('revokes the whole family of the token under the user lock, looking it up by hash only', async () => {
      repository.findByHash.mockResolvedValue(buildStoredToken());
      repository.revokeFamily.mockResolvedValue(1);

      await expect(service.revoke('refresh-token')).resolves.toBeUndefined();

      expect(repository.findByHash).toHaveBeenCalledWith(
        sha256('refresh-token'),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(repository.revokeFamily).toHaveBeenCalledWith('family-1', tx);
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.SESSION_ENDED,
          entity: AuditEntity.SESSION,
          entityId: 'family-1',
          actorId: 'user-1',
          metadata: { userId: 'user-1', revokedTokens: 1 },
        },
        tx,
      );
      expectLockedBefore(repository.revokeFamily, auditService.log);
      expect(loggerWarn).not.toHaveBeenCalled();
    });

    it('does not audit a logout that revoked nothing (session already ended)', async () => {
      repository.findByHash.mockResolvedValue(
        buildStoredToken({ isRevoked: true, revokedAt: ago(DAY_MS) }),
      );
      repository.revokeFamily.mockResolvedValue(0);

      await expect(service.revoke('refresh-token')).resolves.toBeUndefined();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('fails the logout when its audit entry cannot be written, so the revocation rolls back with it', async () => {
      const error = new Error('audit insert failed');
      repository.findByHash.mockResolvedValue(buildStoredToken());
      repository.revokeFamily.mockResolvedValue(1);
      auditService.log.mockRejectedValue(error);

      await expect(service.revoke('refresh-token')).rejects.toBe(error);
    });

    it('still ends the session when given a token that was already rotated', async () => {
      repository.findByHash.mockResolvedValue(
        buildStoredToken({ isRevoked: true, revokedAt: ago(DAY_MS) }),
      );

      await expect(service.revoke('refresh-token')).resolves.toBeUndefined();
      expect(repository.revokeFamily).toHaveBeenCalledWith('family-1', tx);
    });

    it('does nothing for an unknown token', async () => {
      repository.findByHash.mockResolvedValue(null);

      await expect(service.revoke('unknown-token')).resolves.toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(usersService.lockForUpdate).not.toHaveBeenCalled();
      expect(repository.revokeFamily).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
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
      expect(repository.deleteStale).toHaveBeenCalledWith(ago(30 * DAY_MS));
    });
  });
});
