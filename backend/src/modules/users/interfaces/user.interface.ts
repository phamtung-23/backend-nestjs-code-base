import { User } from '@prisma/client';

// A user as the rest of the app sees it: never carries the password hash
export type PublicUser = Omit<User, 'password'>;

// Only credential checks get the hash
export type UserWithPassword = PublicUser & Pick<User, 'password'>;

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
}
