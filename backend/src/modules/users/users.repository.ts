import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser, UserWithPassword } from './interfaces/user.interface';

// Every column except the password hash
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatar: true,
  role: true,
  isActive: true,
  isEmailVerified: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const USER_WITH_PASSWORD_SELECT = {
  ...PUBLIC_USER_SELECT,
  password: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
  }

  findByEmail(
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser | null> {
    return this.db(tx).user.findUnique({
      where: { email },
      select: PUBLIC_USER_SELECT,
    });
  }

  // The only reads of the password hash, for credential checks
  findWithPasswordByEmail(
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserWithPassword | null> {
    return this.db(tx).user.findUnique({
      where: { email },
      select: USER_WITH_PASSWORD_SELECT,
    });
  }

  findWithPasswordById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserWithPassword | null> {
    return this.db(tx).user.findUnique({
      where: { id },
      select: USER_WITH_PASSWORD_SELECT,
    });
  }

  // Serializes session issuance and revocation for one user: every
  // transaction that creates or revokes their sessions or codes takes this
  // lock first, so a password reset can't miss a token issued concurrently
  async lockForUpdate(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
    return rows.length === 1;
  }

  create(
    data: Prisma.UserCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser> {
    return this.db(tx).user.create({ data, select: PUBLIC_USER_SELECT });
  }

  update(
    id: string,
    data: Prisma.UserUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser> {
    return this.db(tx).user.update({
      where: { id },
      data,
      select: PUBLIC_USER_SELECT,
    });
  }
}
