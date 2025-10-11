import { Request } from 'express';
import { User as PrismaUser } from '@prisma/client';

export type User = Omit<PrismaUser, 'password'>;

export interface AuthenticatedRequest extends Request {
  user: User;
}
