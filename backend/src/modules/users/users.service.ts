import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateUserInput,
  PublicUser,
  UserWithPassword,
} from './interfaces/user.interface';
import { UsersRepository } from './users.repository';

// The user store other modules depend on. Methods that write accept the
// caller's transaction client so they can join a larger unit of work.
@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser | null> {
    return this.usersRepository.findById(id, tx);
  }

  findByEmail(email: string): Promise<PublicUser | null> {
    return this.usersRepository.findByEmail(email);
  }

  findWithPasswordByEmail(email: string): Promise<UserWithPassword | null> {
    return this.usersRepository.findWithPasswordByEmail(email);
  }

  findWithPasswordById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserWithPassword | null> {
    return this.usersRepository.findWithPasswordById(id, tx);
  }

  // See UsersRepository.lockForUpdate
  lockForUpdate(id: string, tx: Prisma.TransactionClient): Promise<boolean> {
    return this.usersRepository.lockForUpdate(id, tx);
  }

  create(
    input: CreateUserInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser> {
    return this.usersRepository.create(
      {
        email: input.email,
        password: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
      },
      tx,
    );
  }

  setPassword(
    id: string,
    passwordHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser> {
    return this.usersRepository.update(id, { password: passwordHash }, tx);
  }

  markEmailVerified(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser> {
    return this.usersRepository.update(id, { isEmailVerified: true }, tx);
  }

  recordLogin(id: string, tx?: Prisma.TransactionClient): Promise<PublicUser> {
    return this.usersRepository.update(id, { lastLoginAt: new Date() }, tx);
  }
}
