import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
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

  // One keyset page (see cursorWhere); the select always includes the id
  findMany(
    args: {
      where: Prisma.AuditLogWhereInput;
      orderBy: Prisma.AuditLogOrderByWithRelationInput[];
      select: Prisma.AuditLogSelect;
      take: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<Array<Partial<AuditLog> & { id: string }>> {
    return this.db(tx).auditLog.findMany(args);
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
