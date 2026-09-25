import { Injectable } from '@nestjs/common';
import { Prisma, RefreshToken } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  create(
    data: {
      tokenHash: string;
      familyId: string;
      userId: string;
      expiresAt: Date;
      userAgent?: string;
      ipAddress?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<RefreshToken> {
    return this.db(tx).refreshToken.create({ data });
  }

  findByHash(
    tokenHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RefreshToken | null> {
    return this.db(tx).refreshToken.findUnique({ where: { tokenHash } });
  }

  // Conditional, so of two concurrent refreshes with the same token only one
  // can rotate it
  async revokeIfActive(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await this.db(tx).refreshToken.updateMany({
      where: { id, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    return count === 1;
  }

  async revokeFamily(
    familyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const { count } = await this.db(tx).refreshToken.updateMany({
      where: { familyId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    return count;
  }

  async revokeAllForUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const { count } = await this.db(tx).refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    return count;
  }

  // Runs its own batches instead of joining a transaction, so a large backlog
  // never turns into one huge delete
  async deleteStale(revokedBefore: Date, batchSize = 5000): Promise<number> {
    const where: Prisma.RefreshTokenWhereInput = {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRevoked: true, createdAt: { lt: revokedBefore } },
      ],
    };
    let total = 0;
    for (;;) {
      const batch = await this.prisma.refreshToken.findMany({
        where,
        select: { id: true },
        take: batchSize,
      });
      if (batch.length === 0) return total;
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      total += count;
      if (batch.length < batchSize) return total;
    }
  }
}
