import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, RefreshToken } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser } from '../users/interfaces/user.interface';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import {
  AuthErrorCode,
  REFRESH_REUSE_GRACE_MS,
  REVOKED_TOKEN_RETENTION_MS,
} from './auth.constants';
import { AuthTokens, JwtPayload } from './interfaces/auth.interface';
import { RefreshTokenRepository } from './refresh-token.repository';

// Only a hash is stored, so a database leak doesn't hand out live sessions
const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
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

  // A new familyId starts a new session; rotation passes the current one on
  async issue(
    user: Pick<PublicUser, 'id' | 'email' | 'role'>,
    client: ClientMeta,
    tx?: Prisma.TransactionClient,
    familyId: string = randomUUID(),
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
        familyId,
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
    if (!stored || stored.userId !== payload.sub) {
      throw this.invalidRefreshToken();
    }
    if (stored.isRevoked) {
      await this.handleReuse(stored);
      throw this.invalidRefreshToken();
    }
    if (stored.expiresAt < new Date()) {
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
      return this.issue(user, client, tx, stored.familyId);
    });
    if (!tokens) {
      throw this.invalidRefreshToken();
    }
    return tokens;
  }

  // Ends the session the token belongs to (its whole family). Idempotent:
  // unknown or already revoked tokens are ignored.
  async revoke(refreshToken: string): Promise<void> {
    const stored = await this.refreshTokenRepository.findByHash(
      hashToken(refreshToken),
    );
    if (stored) {
      await this.revokeFamily(
        stored.userId,
        stored.familyId,
        AuditAction.SESSION_ENDED,
      );
    }
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

  // A revoked token presented again. Right after its rotation that is usually
  // two tabs refreshing at once; later it means the token was copied, so the
  // whole family is revoked and whoever holds its newest token loses it too.
  private async handleReuse(stored: RefreshToken): Promise<void> {
    const revokedFor = stored.revokedAt
      ? Date.now() - stored.revokedAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (revokedFor <= REFRESH_REUSE_GRACE_MS) {
      return;
    }
    const revoked = await this.revokeFamily(
      stored.userId,
      stored.familyId,
      AuditAction.SESSION_REUSE_DETECTED,
    );
    if (revoked > 0) {
      this.logger.warn(
        `Refresh token reuse for user ${stored.userId}: revoked ${revoked} token(s) of that session`,
      );
    }
  }

  // Under the user lock, like every other revocation, so a rotation that is
  // inserting the family's next token can't slip past it. Audited only when
  // something was actually revoked.
  private revokeFamily(
    userId: string,
    familyId: string,
    action:
      | typeof AuditAction.SESSION_ENDED
      | typeof AuditAction.SESSION_REUSE_DETECTED,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await this.usersService.lockForUpdate(userId, tx);
      const revoked = await this.refreshTokenRepository.revokeFamily(
        familyId,
        tx,
      );
      if (revoked > 0) {
        await this.auditService.log(
          {
            action,
            entity: AuditEntity.SESSION,
            entityId: familyId,
            // A reused token was presented by someone who isn't necessarily the owner
            actorId: action === AuditAction.SESSION_ENDED ? userId : null,
            metadata: { userId, revokedTokens: revoked },
          },
          tx,
        );
      }
      return revoked;
    });
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
