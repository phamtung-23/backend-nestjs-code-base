import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenRepository } from './refresh-token.repository';

const NOW = new Date('2026-09-25T10:00:00.000Z');

const buildRefreshTokenDelegate = () => ({
  create: jest.fn().mockResolvedValue({ id: 'rt-1' }),
  findUnique: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
});

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe('RefreshTokenRepository', () => {
  let prisma: { refreshToken: ReturnType<typeof buildRefreshTokenDelegate> };
  let tx: { refreshToken: ReturnType<typeof buildRefreshTokenDelegate> };
  let repository: RefreshTokenRepository;

  const asTx = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    prisma = { refreshToken: buildRefreshTokenDelegate() };
    tx = { refreshToken: buildRefreshTokenDelegate() };
    repository = new RefreshTokenRepository(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    const data = {
      tokenHash: 'a'.repeat(64),
      familyId: 'family-1',
      userId: 'user-1',
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      userAgent: 'jest',
      ipAddress: '203.0.113.7',
    };

    it('stores the token hash and nothing else identifying the token', async () => {
      await expect(repository.create(data)).resolves.toEqual({ id: 'rt-1' });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({ data });
      expect(
        prisma.refreshToken.create.mock.calls[0][0].data,
      ).not.toHaveProperty('token');
    });

    it('stores the token hash within the given transaction', async () => {
      await repository.create(data, asTx());

      expect(tx.refreshToken.create).toHaveBeenCalledWith({ data });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('findByHash', () => {
    it('looks the token up by its hash', async () => {
      await repository.findByHash('hash');

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hash' },
      });
    });

    it('looks the token up within the given transaction', async () => {
      await repository.findByHash('hash', asTx());

      expect(tx.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hash' },
      });
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('revokeIfActive', () => {
    it('revokes the token only if it is not revoked yet', async () => {
      await expect(repository.revokeIfActive('rt-1', asTx())).resolves.toBe(
        true,
      );

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', isRevoked: false },
        data: { isRevoked: true, revokedAt: NOW },
      });
    });

    it('returns false when a concurrent refresh revoked it first', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.revokeIfActive('rt-1')).resolves.toBe(false);
    });
  });

  describe('revokeFamily', () => {
    it('revokes every active token of the family, records when, and returns the count', async () => {
      tx.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expect(repository.revokeFamily('family-1', asTx())).resolves.toBe(
        3,
      );
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', isRevoked: false },
        data: { isRevoked: true, revokedAt: NOW },
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('returns 0 when the family has no active tokens, outside a transaction too', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.revokeFamily('family-1')).resolves.toBe(0);
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active token of the user and returns the count', async () => {
      tx.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(repository.revokeAllForUser('user-1', asTx())).resolves.toBe(
        2,
      );
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRevoked: false },
        data: { isRevoked: true, revokedAt: NOW },
      });
    });
  });

  describe('deleteStale', () => {
    const revokedBefore = new Date(NOW.getTime() - 30 * 86_400_000);
    const staleWhere = {
      OR: [
        { expiresAt: { lt: NOW } },
        { isRevoked: true, createdAt: { lt: revokedBefore } },
      ],
    };

    it('selects stale ids in batches of 5000 by default and deletes them by id', async () => {
      prisma.refreshToken.findMany.mockResolvedValueOnce(rows('a', 'b'));
      prisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 2 });

      await expect(repository.deleteStale(revokedBefore)).resolves.toBe(2);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: staleWhere,
        select: { id: true },
        take: 5000,
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
      });
    });

    it('returns 0 without deleting when nothing is stale', async () => {
      await expect(repository.deleteStale(revokedBefore)).resolves.toBe(0);
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('keeps deleting full batches until a short batch and sums the counts', async () => {
      prisma.refreshToken.findMany
        .mockResolvedValueOnce(rows('a', 'b'))
        .mockResolvedValueOnce(rows('c'));
      prisma.refreshToken.deleteMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      await expect(repository.deleteStale(revokedBefore, 2)).resolves.toBe(3);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.refreshToken.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['c'] } },
      });
    });

    it('stops at an empty batch after full ones', async () => {
      prisma.refreshToken.findMany
        .mockResolvedValueOnce(rows('a', 'b'))
        .mockResolvedValueOnce([]);
      prisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 2 });

      await expect(repository.deleteStale(revokedBefore, 2)).resolves.toBe(2);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
