import { Injectable } from '@nestjs/common';
import { Otp, OtpType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OtpRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  create(
    data: { userId: string; type: OtpType; code: string; expiresAt: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<Otp> {
    return this.db(tx).otp.create({ data });
  }

  findLatestActive(
    userId: string,
    type: OtpType,
    tx?: Prisma.TransactionClient,
  ): Promise<Otp | null> {
    return this.db(tx).otp.findFirst({
      where: { userId, type, isUsed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Counts an attempt only while the code is unused and under the limit;
  // conditional, so parallel guesses can't exceed it
  async registerAttempt(
    id: string,
    maxAttempts: number,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await this.db(tx).otp.updateMany({
      where: { id, isUsed: false, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  // Conditional, so the same code can't be consumed twice concurrently
  async markUsed(id: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await this.db(tx).otp.updateMany({
      where: { id, isUsed: false },
      data: { isUsed: true },
    });
    return count === 1;
  }

  async invalidateActive(
    userId: string,
    type: OtpType,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).otp.updateMany({
      where: { userId, type, isUsed: false },
      data: { isUsed: true },
    });
  }

  findIssuedSince(
    userId: string,
    type: OtpType,
    since: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<Date[]> {
    return this.db(tx)
      .otp.findMany({
        where: { userId, type, createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((rows) => rows.map((row) => row.createdAt));
  }

  // Runs its own batches instead of joining a transaction, so a large backlog
  // never turns into one huge delete
  async deleteStale(usedBefore: Date, batchSize = 5000): Promise<number> {
    const where: Prisma.OtpWhereInput = {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isUsed: true, createdAt: { lt: usedBefore } },
      ],
    };
    let total = 0;
    for (;;) {
      const batch = await this.prisma.otp.findMany({
        where,
        select: { id: true },
        take: batchSize,
      });
      if (batch.length === 0) return total;
      const { count } = await this.prisma.otp.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      total += count;
      if (batch.length < batchSize) return total;
    }
  }
}
