import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  async create(
    data: Prisma.AuditLogCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).auditLog.create({ data, select: { id: true } });
  }

  async findPage(args: {
    where: Prisma.AuditLogWhereInput;
    orderBy: Prisma.AuditLogOrderByWithRelationInput[];
    select: Prisma.AuditLogSelect;
    skip: number;
    take: number;
  }) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany(args),
      this.prisma.auditLog.count({ where: args.where }),
    ]);
    return { items, total };
  }

  // In batches, so a large backlog never becomes one long-running delete
  async deleteOlderThan(cutoff: Date, batchSize = 5000): Promise<number> {
    let total = 0;
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: batchSize,
      });
      if (batch.length === 0) return total;
      const { count } = await this.prisma.auditLog.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      total += count;
      if (batch.length < batchSize) return total;
    }
  }
}
