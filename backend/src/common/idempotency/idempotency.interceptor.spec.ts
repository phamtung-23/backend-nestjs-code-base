import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { lastValueFrom, Observable, of, throwError } from 'rxjs';
import { AuthConfig } from '../../config/auth.config';
import { RedisClient } from '../../redis/redis.constants';
import { ErrorCode } from '../constants/error-codes';
import { SuccessEnvelope } from '../helpers/response.helper';
import {
  IDEMPOTENT_REPLAY_HEADER,
  IdempotencyInterceptor,
} from './idempotency.interceptor';

const KEY = 'c0ffee00-1234-4abc-9def-0123456789ab';
const BODY = { email: 'jane@example.com', password: 'Passw0rd!' };
const URL = '/v1/auth/register';
const SECRET = 'test-jwt-secret';
const fingerprintKey = (secret: string) =>
  Buffer.from(hkdfSync('sha256', secret, '', 'idempotency-fingerprint', 32));
const fingerprintOf = (url: string, body: unknown, secret = SECRET) =>
  createHmac('sha256', fingerprintKey(secret))
    .update(JSON.stringify({ url, body }))
    .digest('hex');
const FINGERPRINT = fingerprintOf(URL, BODY);
const ANONYMOUS_KEY = `idempotency:ip:203.0.113.7:AuthController.register:${KEY}`;
const PROCESSING_TTL = { type: 'PX', value: 60_000 };
const RESULT_TTL = { type: 'PX', value: 24 * 60 * 60 * 1000 };

class AuthController {}
function register() {
  return undefined;
}

async function expectHttpError(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  errorCode: string,
): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('Expected the call to reject');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ errorCode });
}

describe('IdempotencyInterceptor', () => {
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let request: {
    header: jest.Mock;
    ip: string;
    originalUrl: string;
    body: unknown;
    user?: { id: string };
  };
  let response: { setHeader: jest.Mock };
  let handlerResult: Observable<unknown>;
  let next: CallHandler & { handle: jest.Mock };
  let loggerError: jest.SpyInstance;
  let interceptor: IdempotencyInterceptor;

  const withKey = (key: string | undefined) => {
    request.header.mockImplementation((name: string) =>
      name.toLowerCase() === 'idempotency-key' ? key : undefined,
    );
  };

  const context = () =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getClass: () => AuthController,
      getHandler: () => register,
    }) as unknown as ExecutionContext;

  // Runs the interceptor and subscribes to the observable Nest would return
  const run = async () =>
    lastValueFrom(await interceptor.intercept(context(), next));

  const stored = (record: object) => JSON.stringify(record);

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };
    request = {
      header: jest.fn(),
      ip: '203.0.113.7',
      originalUrl: URL,
      body: BODY,
    };
    response = { setHeader: jest.fn() };
    handlerResult = of({ status: 'success', data: { id: 'user-1' } });
    next = { handle: jest.fn(() => handlerResult) };
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    withKey(KEY);

    interceptor = createInterceptor(SECRET);
  });

  const createInterceptor = (secret: string) =>
    new IdempotencyInterceptor(
      redis as unknown as RedisClient,
      {
        jwtSecret: secret,
      } as AuthConfig,
    );

  afterEach(() => loggerError.mockRestore());

  describe('without an Idempotency-Key header', () => {
    it('runs the handler untouched and never talks to Redis', async () => {
      withKey(undefined);

      const observable = await interceptor.intercept(context(), next);

      expect(observable).toBe(handlerResult);
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
    });
  });

  describe('key validation', () => {
    it.each([
      ['too short', 'abc1234'],
      ['too long', 'k'.repeat(256)],
      ['with spaces', 'has spaces in it'],
      ['with other symbols', 'key!with$symbols'],
      ['empty', ''],
      ['sent twice (joined with a comma)', `${KEY}, ${KEY}`],
    ])(
      'returns 400 IDEMPOTENCY_KEY_INVALID for a key %s',
      async (_case, key) => {
        withKey(key);

        await expectHttpError(
          interceptor.intercept(context(), next),
          BadRequestException,
          ErrorCode.IDEMPOTENCY_KEY_INVALID,
        );
        expect(redis.set).not.toHaveBeenCalled();
        expect(next.handle).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['8 characters', 'abcd-_12'],
      ['255 characters', 'k'.repeat(255)],
    ])('accepts a key of %s', async (_case, key) => {
      withKey(key);

      await expect(run()).resolves.toBeDefined();
    });
  });

  describe('first request with a key', () => {
    it('claims the key with SET NX for 60s before running the handler', async () => {
      await run();

      expect(redis.set).toHaveBeenNthCalledWith(
        1,
        ANONYMOUS_KEY,
        stored({ state: 'processing', fingerprint: FINGERPRINT }),
        { condition: 'NX', expiration: PROCESSING_TTL },
      );
      expect(redis.set.mock.invocationCallOrder[0]).toBeLessThan(
        next.handle.mock.invocationCallOrder[0],
      );
    });

    it('scopes the key to the authenticated user instead of the IP', async () => {
      request.user = { id: 'user-1' };

      await run();

      expect(redis.set.mock.calls[0][0]).toBe(
        `idempotency:user-1:AuthController.register:${KEY}`,
      );
    });

    it('keys the fingerprint with the app secret, so a stored one reveals nothing about the password', async () => {
      await run();
      const fingerprint = (
        JSON.parse(redis.set.mock.calls[0][1]) as { fingerprint: string }
      ).fingerprint;

      const plainHash = createHash('sha256')
        .update(JSON.stringify({ url: URL, body: BODY }))
        .digest('hex');
      expect(fingerprint).not.toBe(plainHash);
      expect(fingerprint).not.toBe(fingerprintOf(URL, BODY, 'other-secret'));
      expect(fingerprint).toBe(FINGERPRINT);
    });

    it('fingerprints a missing body as null', async () => {
      request.body = undefined;

      await run();

      expect(JSON.parse(redis.set.mock.calls[0][1])).toEqual({
        state: 'processing',
        fingerprint: fingerprintOf(URL, null),
      });
    });

    it('fingerprints the URL too, so another path id or query is a different request', async () => {
      withKey(KEY);
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        stored({ state: 'done', fingerprint: FINGERPRINT, body: {} }),
      );
      request.originalUrl = '/v1/orders/other-id/cancel';

      await expectHttpError(
        run(),
        UnprocessableEntityException,
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(next.handle).not.toHaveBeenCalled();
    });

    it('treats an unreadable stored record as still in progress', async () => {
      withKey(KEY);
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue('{not json');

      await expectHttpError(
        run(),
        ConflictException,
        'IDEMPOTENCY_KEY_IN_PROGRESS',
      );
    });

    it('stores the successful body for 24h and returns it', async () => {
      const body = { status: 'success', data: { id: 'user-1' } };

      await expect(run()).resolves.toEqual(body);

      expect(next.handle).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenNthCalledWith(
        2,
        ANONYMOUS_KEY,
        stored({
          state: 'done',
          fingerprint: FINGERPRINT,
          body,
          enveloped: false,
        }),
        { expiration: RESULT_TTL },
      );
    });

    it('remembers that the body was a SuccessEnvelope', async () => {
      handlerResult = of(new SuccessEnvelope({ id: 'user-1' }, 'Registered'));

      await run();

      expect(JSON.parse(redis.set.mock.calls[1][1])).toMatchObject({
        body: { status: 'success', message: 'Registered' },
        enveloped: true,
      });
    });

    it('still returns the body when storing the outcome fails, and logs it', async () => {
      const error = new Error('Redis write failed');
      redis.set.mockResolvedValueOnce('OK').mockRejectedValueOnce(error);

      await expect(run()).resolves.toEqual({
        status: 'success',
        data: { id: 'user-1' },
      });
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining(ANONYMOUS_KEY),
        error.stack,
      );
    });

    it('logs storage failures that are not Error instances as strings', async () => {
      redis.set.mockResolvedValueOnce('OK').mockRejectedValueOnce('OOM');

      await run();

      expect(loggerError).toHaveBeenCalledWith(expect.any(String), 'OOM');
    });

    it('stores a 4xx outcome for 24h and rethrows the same error', async () => {
      const error = new ConflictException({
        errorCode: 'AUTH_EMAIL_TAKEN',
        message: 'An account with this email already exists',
      });
      handlerResult = throwError(() => error);

      await expect(run()).rejects.toBe(error);
      expect(redis.set).toHaveBeenNthCalledWith(
        2,
        ANONYMOUS_KEY,
        stored({
          state: 'failed',
          fingerprint: FINGERPRINT,
          status: 409,
          response: {
            errorCode: 'AUTH_EMAIL_TAKEN',
            message: 'An account with this email already exists',
          },
        }),
        { expiration: RESULT_TTL },
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('releases the key after a validation failure, so a corrected body can reuse it', async () => {
      const error = new BadRequestException({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        details: [{ field: 'email', message: 'email must be an email' }],
      });
      handlerResult = throwError(() => error);

      await expect(run()).rejects.toBe(error);
      expect(redis.del).toHaveBeenCalledWith(ANONYMOUS_KEY);
      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it('stores a 400 thrown by the handler itself (a string response too)', async () => {
      const error = new BadRequestException('Unsupported option');
      handlerResult = throwError(() => error);

      await expect(run()).rejects.toBe(error);
      expect(redis.set).toHaveBeenCalledTimes(2);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rethrows a 4xx error even when storing it fails', async () => {
      const error = new ConflictException();
      handlerResult = throwError(() => error);
      redis.set
        .mockResolvedValueOnce('OK')
        .mockRejectedValueOnce(new Error('Redis write failed'));

      await expect(run()).rejects.toBe(error);
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a 5xx HttpException', new ServiceUnavailableException()],
      ['an unexpected error', new Error('database down')],
    ])(
      'releases the key after %s so the client can retry, and rethrows it',
      async (_case, error) => {
        handlerResult = throwError(() => error);

        await expect(run()).rejects.toBe(error);
        expect(redis.del).toHaveBeenCalledWith(ANONYMOUS_KEY);
        expect(redis.set).toHaveBeenCalledTimes(1);
      },
    );

    it('rethrows the original error even when releasing the key fails', async () => {
      const error = new Error('database down');
      handlerResult = throwError(() => error);
      redis.del.mockRejectedValue(new Error('Redis down'));

      await expect(run()).rejects.toBe(error);
    });

    it('returns 503 without running the handler when Redis stops answering', async () => {
      jest.useFakeTimers();
      try {
        redis.set.mockReturnValue(new Promise(() => undefined));

        const pending = interceptor.intercept(context(), next);
        const assertion = expectHttpError(
          pending,
          ServiceUnavailableException,
          ErrorCode.SERVICE_UNAVAILABLE,
        );
        await jest.advanceTimersByTimeAsync(500);

        await assertion;
        expect(next.handle).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns 503 without running the handler when Redis cannot claim the key', async () => {
      redis.set.mockRejectedValue(new Error('The client is closed'));

      await expectHttpError(
        interceptor.intercept(context(), next),
        ServiceUnavailableException,
        ErrorCode.SERVICE_UNAVAILABLE,
      );
      expect(next.handle).not.toHaveBeenCalled();
    });
  });

  describe('retry of a claimed key', () => {
    beforeEach(() => {
      redis.set.mockResolvedValue(null);
    });

    it('returns 422 IDEMPOTENCY_KEY_REUSED when the body differs, whatever the state', async () => {
      redis.get.mockResolvedValue(
        stored({ state: 'processing', fingerprint: 'other-body' }),
      );

      await expectHttpError(
        interceptor.intercept(context(), next),
        UnprocessableEntityException,
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
      );
      expect(redis.get).toHaveBeenCalledWith(ANONYMOUS_KEY);
      expect(next.handle).not.toHaveBeenCalled();
    });

    it.each([
      [
        'still processing',
        stored({ state: 'processing', fingerprint: FINGERPRINT }),
      ],
      ['gone (expired between SET and GET)', null],
    ])(
      'returns 409 IDEMPOTENCY_KEY_IN_PROGRESS when the first request is %s',
      async (_case, raw) => {
        redis.get.mockResolvedValue(raw);

        await expectHttpError(
          interceptor.intercept(context(), next),
          ConflictException,
          ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
        );
        expect(next.handle).not.toHaveBeenCalled();
        expect(response.setHeader).not.toHaveBeenCalled();
      },
    );

    it('returns 409 IDEMPOTENCY_KEY_IN_PROGRESS when the record cannot be read', async () => {
      redis.get.mockRejectedValue(new Error('Redis down'));

      await expectHttpError(
        interceptor.intercept(context(), next),
        ConflictException,
        ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
      );
    });

    it('replays a stored success with the Idempotent-Replayed header, without running the handler', async () => {
      const body = { id: 'user-1' };
      redis.get.mockResolvedValue(
        stored({
          state: 'done',
          fingerprint: FINGERPRINT,
          body,
          enveloped: false,
        }),
      );

      await expect(run()).resolves.toEqual(body);
      expect(response.setHeader).toHaveBeenCalledWith(
        IDEMPOTENT_REPLAY_HEADER,
        'true',
      );
      expect(next.handle).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it('replays a stored envelope as a SuccessEnvelope, so it is not wrapped twice', async () => {
      const body = {
        status: 'success',
        message: 'Registered',
        data: { id: 'user-1' },
      };
      redis.get.mockResolvedValue(
        stored({
          state: 'done',
          fingerprint: FINGERPRINT,
          body,
          enveloped: true,
        }),
      );

      const replayed = await run();

      expect(replayed).toBeInstanceOf(SuccessEnvelope);
      expect(replayed).toEqual(body);
    });

    it('replays a stored 4xx as the same HttpException, with the header', async () => {
      const original = {
        errorCode: 'AUTH_EMAIL_TAKEN',
        message: 'An account with this email already exists',
      };
      redis.get.mockResolvedValue(
        stored({
          state: 'failed',
          fingerprint: FINGERPRINT,
          status: 409,
          response: original,
        }),
      );

      const error = await run().then(
        () => {
          throw new Error('Expected the replay to fail');
        },
        (rejection: unknown) => rejection as HttpException,
      );

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual(original);
      expect(response.setHeader).toHaveBeenCalledWith(
        IDEMPOTENT_REPLAY_HEADER,
        'true',
      );
      expect(next.handle).not.toHaveBeenCalled();
    });
  });
});
