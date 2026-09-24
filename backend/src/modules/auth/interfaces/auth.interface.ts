import { Request } from 'express';
import { User as PrismaUser } from '@prisma/client';

export type User = Omit<PrismaUser, 'password'>;

export interface JwtPayload {
  sub: string;
  // Only set on refresh tokens; access tokens carry email and role instead
  type?: 'refresh';
}

export interface AuthenticatedRequest extends Request {
  user: User;
}
