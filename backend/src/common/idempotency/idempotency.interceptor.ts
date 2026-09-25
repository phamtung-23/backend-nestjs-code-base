import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHmac, hkdfSync } from 'node:crypto';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { REDIS_CLIENT, RedisClient } from '../../redis/redis.constants';
import { withTimeout } from '../../redis/redis.helpers';
import { ErrorCode } from '../constants/error-codes';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replayed';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
// A finished request's outcome is kept this long for replays
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
// Short, so a crashed request doesn't block retries for a day
const PROCESSING_TTL_MS = 60 * 1000;

type StoredRecord =
  | { state: 'processing'; fingerprint: string }
  | { state: 'done'; fingerprint: string; body: unknown }
  | {
      state: 'failed';
      fingerprint: string;
      status: number;
      response: string | object;
    };

const isValidationFailure = (error: HttpException): boolean => {
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    (response as { errorCode?: unknown }).errorCode ===
      ErrorCode.VALIDATION_FAILED
  );
};

// Applied by @Idempotent(). With an Idempotency-Key header, the first request
// runs and its outcome (2xx body, or 4xx error) is stored; retries with the same
// key and body get that outcome replayed instead of running again. 5xx outcomes
// aren't stored, so the client can retry. See .claude/rules/cross-cutting.md.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  // The body holds passwords: a plain hash of it in Redis could be cracked
  // offline at GPU speed, a keyed one can't without the app secret
  private readonly fingerprintKey: Buffer;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    config: ConfigService,
  ) {
    this.fingerprintKey = Buffer.from(
      hkdfSync(
        'sha256',
        config.getOrThrow<string>('JWT_SECRET'),
        '',
        'idempotency-fingerprint',
        32,
      ),
    );
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id: string } }>();
    const key = request.header(IDEMPOTENCY_HEADER);
    if (key === undefined) {
      return next.handle();
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException({
        errorCode: ErrorCode.IDEMPOTENCY_KEY_INVALID,
        message: `${IDEMPOTENCY_HEADER} must be 8-255 characters of letters, digits, "-" or "_"`,
      });
    }

    // Scoped per caller and endpoint, so keys never collide across users/routes
    const caller = request.user?.id ?? `ip:${request.ip}`;
    const endpoint = `${context.getClass().name}.${context.getHandler().name}`;
    const storeKey = `idempotency:${caller}:${endpoint}:${key}`;
    // Covers the URL too: the same key on another path id or query is a
    // different request, not a retry
    const fingerprint = createHmac('sha256', this.fingerprintKey)
      .update(
        JSON.stringify({
          url: request.originalUrl,
          body: request.body ?? null,
        }),
      )
      .digest('hex');

    if (!(await this.claim(storeKey, fingerprint))) {
      return this.replay(storeKey, fingerprint, http.getResponse<Response>());
    }

    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        await this.save(
          storeKey,
          { state: 'done', fingerprint, body },
          RESULT_TTL_MS,
        );
        return body;
      }),
      catchError((error: unknown) =>
        from(this.settleFailure(storeKey, fingerprint, error)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async claim(storeKey: string, fingerprint: string): Promise<boolean> {
    try {
      const reply = await withTimeout(
        this.redis.set(
          storeKey,
          JSON.stringify({ state: 'processing', fingerprint }),
          {
            condition: 'NX',
            expiration: { type: 'PX', value: PROCESSING_TTL_MS },
          },
        ),
      );
      return reply === 'OK';
    } catch {
      // Without the store a retry could run twice; refuse instead
      throw new ServiceUnavailableException({
        errorCode: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Idempotency is temporarily unavailable; retry later',
      });
    }
  }

  private async replay(
    storeKey: string,
    fingerprint: string,
    response: Response,
  ): Promise<Observable<unknown>> {
    const record = this.parse(
      await withTimeout(this.redis.get(storeKey)).catch(() => null),
    );

    if (record && record.fingerprint !== fingerprint) {
      throw new UnprocessableEntityException({
        errorCode: ErrorCode.IDEMPOTENCY_KEY_REUSED,
        message: `This ${IDEMPOTENCY_HEADER} was already used with a different request body`,
      });
    }
    if (!record || record.state === 'processing') {
      throw new ConflictException({
        errorCode: ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
        message:
          'A request with this key is still being processed; retry shortly',
      });
    }

    response.setHeader(IDEMPOTENT_REPLAY_HEADER, 'true');
    if (record.state === 'failed') {
      return throwError(
        () => new HttpException(record.response, record.status),
      );
    }
    // Same handler, so Nest applies the same status code as the original
    return of(record.body);
  }

  // A missing or unreadable record is treated as still in progress (409): the
  // client retries, and the key expires on its own
  private parse(raw: string | null): StoredRecord | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredRecord;
    } catch {
      return null;
    }
  }

  private async settleFailure(
    storeKey: string,
    fingerprint: string,
    error: unknown,
  ): Promise<void> {
    // Nothing ran when validation failed (pipes run inside interceptors), so
    // the client may fix the body and reuse the key; storing it would also let
    // anyone fill Redis with error details sized by their own input
    if (
      error instanceof HttpException &&
      error.getStatus() < 500 &&
      !isValidationFailure(error)
    ) {
      await this.save(
        storeKey,
        {
          state: 'failed',
          fingerprint,
          status: error.getStatus(),
          response: error.getResponse(),
        },
        RESULT_TTL_MS,
      );
    } else {
      // Unexpected failures aren't final: let the client retry
      await withTimeout(this.redis.del(storeKey)).catch(() => undefined);
    }
  }

  private async save(
    storeKey: string,
    record: StoredRecord,
    ttlMs: number,
  ): Promise<void> {
    try {
      await withTimeout(
        this.redis.set(storeKey, JSON.stringify(record), {
          expiration: { type: 'PX', value: ttlMs },
        }),
      );
    } catch (error) {
      // The operation itself succeeded; losing the record only means a retry
      // after PROCESSING_TTL_MS runs again
      this.logger.error(
        `Could not store the idempotent outcome for ${storeKey}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
