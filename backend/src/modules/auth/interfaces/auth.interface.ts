import { Request } from 'express';
import { PublicUser } from '../../users/interfaces/user.interface';

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
}

export interface JwtPayload {
  sub: string;
  // Only set on refresh tokens; access tokens carry email and role instead
  type?: 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSession extends AuthTokens {
  user: PublicUser;
}

// How a session was started, recorded in its session.started audit entry
export type SessionMethod = 'password' | 'code' | 'password_change';
