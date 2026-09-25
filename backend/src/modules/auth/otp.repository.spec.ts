import { OtpType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpRepository } from './otp.repository';

const NOW = new Date('2026-09-25T10:00:00.000Z');

const buildOtpDelegate = () => ({
  create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
});

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe('OtpRepository', () => {
  let prisma: { otp: ReturnType<typeof buildOtpDelegate> };
  let tx: { otp: ReturnType<typeof buildOtpDelegate> };
  let repository: OtpRepository;

  const asTx = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    prisma = { otp: buildOtpDelegate() };
    tx = { otp: buildOtpDelegate() };
    repository = new OtpRepository(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    const data = {
      userId: 'user-1',
      type: OtpType.LOGIN,
      code: '123456',
      expiresAt: new Date(NOW.getTime() + 600_000),
    };

    it('stores the code', async () => {
      await expect(repository.create(data)).resolves.toEqual({ id: 'otp-1' });

      expect(prisma.otp.create).toHaveBeenCalledWith({ data });
    });

    it('stores the code within the given transaction', async () => {
      await repository.create(data, asTx());

      expect(tx.otp.create).toHaveBeenCalledWith({ data });
      expect(prisma.otp.create).not.toHaveBeenCalled();
    });
  });

  describe('findLatestActive', () => {
    it('returns the newest unused, unexpired code of the type', async () => {
      await repository.findLatestActive('user-1', OtpType.VERIFICATION, asTx());

      expect(tx.otp.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          type: OtpType.VERIFICATION,
          isUsed: false,
          expiresAt: { gt: NOW },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('registerAttempt', () => {
    it('increments attempts only while the code is unused and under the limit', async () => {
      await expect(
        repository.registerAttempt('otp-1', 5, asTx()),
      ).resolves.toBe(true);

      expect(tx.otp.updateMany).toHaveBeenCalledWith({
        where: { id: 'otp-1', isUsed: false, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
    });

    it('returns false when the conditional update matched nothing', async () => {
      prisma.otp.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.registerAttempt('otp-1', 5)).resolves.toBe(false);
    });
  });

  describe('markUsed', () => {
    it('marks the code used only if it is still unused', async () => {
      await expect(repository.markUsed('otp-1', asTx())).resolves.toBe(true);

      expect(tx.otp.updateMany).toHaveBeenCalledWith({
        where: { id: 'otp-1', isUsed: false },
        data: { isUsed: true },
      });
    });

    it('returns false when a concurrent request used it first', async () => {
      prisma.otp.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.markUsed('otp-1')).resolves.toBe(false);
    });
  });

  describe('invalidateActive', () => {
    it('marks every unused code of the type as used', async () => {
      await expect(
        repository.invalidateActive('user-1', OtpType.PASSWORD_RESET, asTx()),
      ).resolves.toBeUndefined();

      expect(tx.otp.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          type: OtpType.PASSWORD_RESET,
          isUsed: false,
        },
        data: { isUsed: true },
      });
    });
  });

  describe('findIssuedSince', () => {
    const since = new Date(NOW.getTime() - 3_600_000);

    it('returns the creation times of codes of the type issued since the cutoff, newest first', async () => {
      const newer = new Date(NOW.getTime() - 60_000);
      const older = new Date(NOW.getTime() - 120_000);
      tx.otp.findMany.mockResolvedValue([
        { createdAt: newer },
        { createdAt: older },
      ]);

      await expect(
        repository.findIssuedSince('user-1', OtpType.LOGIN, since, asTx()),
      ).resolves.toEqual([newer, older]);
      expect(tx.otp.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          type: OtpType.LOGIN,
          createdAt: { gte: since },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('counts used and invalidated codes too, and works outside a transaction', async () => {
      await expect(
        repository.findIssuedSince('user-1', OtpType.LOGIN, since),
      ).resolves.toEqual([]);

      const [{ where }] = prisma.otp.findMany.mock.calls[0];
      expect(where).not.toHaveProperty('isUsed');
    });
  });

  describe('deleteStale', () => {
    const usedBefore = new Date(NOW.getTime() - 86_400_000);
    const staleWhere = {
      OR: [
        { expiresAt: { lt: NOW } },
        { isUsed: true, createdAt: { lt: usedBefore } },
      ],
    };

    it('selects stale ids in batches of 5000 by default and deletes them by id', async () => {
      prisma.otp.findMany.mockResolvedValueOnce(rows('a', 'b'));
      prisma.otp.deleteMany.mockResolvedValueOnce({ count: 2 });

      await expect(repository.deleteStale(usedBefore)).resolves.toBe(2);
      expect(prisma.otp.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.otp.findMany).toHaveBeenCalledWith({
        where: staleWhere,
        select: { id: true },
        take: 5000,
      });
      expect(prisma.otp.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
      });
    });

    it('returns 0 without deleting when nothing is stale', async () => {
      await expect(repository.deleteStale(usedBefore)).resolves.toBe(0);
      expect(prisma.otp.deleteMany).not.toHaveBeenCalled();
    });

    it('keeps deleting full batches until a short batch and sums the counts', async () => {
      prisma.otp.findMany
        .mockResolvedValueOnce(rows('a', 'b'))
        .mockResolvedValueOnce(rows('c', 'd'))
        .mockResolvedValueOnce(rows('e'));
      prisma.otp.deleteMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      await expect(repository.deleteStale(usedBefore, 2)).resolves.toBe(5);
      expect(prisma.otp.findMany).toHaveBeenCalledTimes(3);
      expect(prisma.otp.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 2 }),
      );
      expect(prisma.otp.deleteMany).toHaveBeenNthCalledWith(3, {
        where: { id: { in: ['e'] } },
      });
    });

    it('stops at an empty batch after full ones', async () => {
      prisma.otp.findMany
        .mockResolvedValueOnce(rows('a', 'b'))
        .mockResolvedValueOnce([]);
      prisma.otp.deleteMany.mockResolvedValueOnce({ count: 2 });

      await expect(repository.deleteStale(usedBefore, 2)).resolves.toBe(2);
      expect(prisma.otp.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.otp.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('counts only rows it actually deleted when another instance got there first', async () => {
      prisma.otp.findMany.mockResolvedValueOnce(rows('a', 'b', 'c'));
      prisma.otp.deleteMany.mockResolvedValueOnce({ count: 1 });

      await expect(repository.deleteStale(usedBefore)).resolves.toBe(1);
    });
  });
});
