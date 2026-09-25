import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditRepository } from './audit.repository';

describe('AuditRepository', () => {
  const data = {
    action: 'user.registered',
    entity: 'user',
    entityId: 'user-1',
    actorId: 'user-1',
    ipAddress: '203.0.113.7',
  };

  let prisma: {
    auditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: { auditLog: { create: jest.Mock } };
  let repository: AuditRepository;

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
        findMany: jest.fn().mockReturnValue('find-many-query'),
        count: jest.fn().mockReturnValue('count-query'),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    tx = { auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) } };
    repository = new AuditRepository(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('inserts the entry selecting only its id, and returns nothing', async () => {
      await expect(repository.create(data)).resolves.toBeUndefined();

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data,
        select: { id: true },
      });
    });

    it('inserts within the given transaction', async () => {
      await repository.create(data, tx as unknown as Prisma.TransactionClient);

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data,
        select: { id: true },
      });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('findMany', () => {
    it('reads one keyset page with the given arguments, without counting', async () => {
      const args = {
        where: { action: 'user.registered' },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        select: { id: true, action: true, createdAt: true },
        take: 11,
      };
      const rows = [{ id: 'log-1', action: 'user.registered' }];
      prisma.auditLog.findMany.mockResolvedValue(rows);

      await expect(repository.findMany(args)).resolves.toBe(rows);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(args);
      expect(prisma.auditLog.count).not.toHaveBeenCalled();
    });

    it('reads within the given transaction', async () => {
      const txFindMany = jest.fn().mockResolvedValue([]);
      const args = {
        where: {},
        orderBy: [{ createdAt: 'desc' as const }],
        select: { id: true },
        take: 1,
      };

      await repository.findMany(args, {
        auditLog: { findMany: txFindMany },
      } as unknown as Prisma.TransactionClient);

      expect(txFindMany).toHaveBeenCalledWith(args);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteOlderThan', () => {
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    const rows = (count: number, offset = 0) =>
      Array.from({ length: count }, (_, i) => ({ id: `log-${offset + i}` }));

    it('deletes old entries in batches until a batch comes back short', async () => {
      prisma.auditLog.findMany
        .mockResolvedValueOnce(rows(2))
        .mockResolvedValueOnce(rows(1, 2));
      prisma.auditLog.deleteMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      await expect(repository.deleteOlderThan(cutoff, 2)).resolves.toBe(3);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: 2,
      });
      expect(prisma.auditLog.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: ['log-0', 'log-1'] } },
      });
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('stops at an empty batch', async () => {
      prisma.auditLog.findMany
        .mockResolvedValueOnce(rows(2))
        .mockResolvedValueOnce([]);
      prisma.auditLog.deleteMany.mockResolvedValueOnce({ count: 2 });

      await expect(repository.deleteOlderThan(cutoff, 2)).resolves.toBe(2);
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('uses batches of 5000 by default', async () => {
      prisma.auditLog.findMany.mockResolvedValueOnce([]);

      await expect(repository.deleteOlderThan(cutoff)).resolves.toBe(0);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5000 }),
      );
    });
  });
});
