import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { AuthErrorCode, REVOKED_TOKEN_RETENTION_MS } from './auth.constants';
import { AuthTokens, JwtPayload } from './interfaces/auth.interface';
import { RefreshTokenRepository } from './refresh-token.repository';

// Only a hash is stored, so a database leak doesn't hand out live sessions
const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class TokenService {
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly usersService: UsersService,
    configService: ConfigService,
  ) {
    this.refreshSecret = configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    // Defaults live in env validation
    this.accessExpiresIn = configService.getOrThrow<string>(
      'JWT_ACCESS_EXPIRES_IN',
    );
    this.refreshExpiresIn = configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
  }

  async issue(
    user: Pick<PublicUser, 'id' | 'email' | 'role'>,
    client: ClientMeta,
    tx?: Prisma.TransactionClient,
  ): Promise<AuthTokens> {
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: this.accessExpiresIn },
    );

    // Separate secret so it can never pass as an access token; jti keeps
    // tokens unique when two are issued within the same second
    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh', jti: randomUUID() },
      { secret: this.refreshSecret, expiresIn: this.refreshExpiresIn },
    );
    const { exp } = this.jwtService.decode<{ exp: number }>(refreshToken);

    await this.refreshTokenRepository.create(
      {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(exp * 1000),
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
      },
      tx,
    );

    return { accessToken, refreshToken };
  }

  // Exchanges a refresh token for a new pair; the old one stops working
  async rotate(refreshToken: string, client: ClientMeta): Promise<AuthTokens> {
    const payload = this.verifyRefreshToken(refreshToken);
    const stored = await this.refreshTokenRepository.findByHash(
      hashToken(refreshToken),
    );
    if (
      !stored ||
      stored.isRevoked ||
      stored.expiresAt < new Date() ||
      stored.userId !== payload.sub
    ) {
      throw this.invalidRefreshToken();
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      // Serializes with password changes/resets and logout-all, which revoke
      // every token of the user while holding the same lock
      await this.usersService.lockForUpdate(stored.userId, tx);
      const user = await this.usersService.findById(stored.userId, tx);
      if (!user?.isActive) {
        return null;
      }
      if (!(await this.refreshTokenRepository.revokeIfActive(stored.id, tx))) {
        return null; // a concurrent request already rotated this token
      }
      return this.issue(user, client, tx);
    });
    if (!tokens) {
      throw this.invalidRefreshToken();
    }
    return tokens;
  }

  // Idempotent: unknown or already revoked tokens are ignored
  revoke(refreshToken: string): Promise<void> {
    return this.refreshTokenRepository.revokeByHash(hashToken(refreshToken));
  }

  revokeAllForUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    return this.refreshTokenRepository.revokeAllForUser(userId, tx);
  }

  // Deletes expired tokens and revoked ones older than 30 days
  cleanup(): Promise<number> {
    return this.refreshTokenRepository.deleteStale(
      new Date(Date.now() - REVOKED_TOKEN_RETENTION_MS),
    );
  }

  private verifyRefreshToken(refreshToken: string): JwtPayload {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw this.invalidRefreshToken();
    }
    if (payload.type !== 'refresh') {
      throw this.invalidRefreshToken();
    }
    return payload;
  }

  private invalidRefreshToken() {
    return new UnauthorizedException({
      errorCode: AuthErrorCode.INVALID_REFRESH_TOKEN,
      message: 'Invalid or expired refresh token',
    });
  }
}
