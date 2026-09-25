import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisClient } from '../../redis/redis.constants';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const fallbackRecord = {
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  };

  let redis: { isReady: boolean; eval: jest.Mock };
  let fallback: { increment: jest.Mock };
  let loggerWarn: jest.SpyInstance;
  let loggerLog: jest.SpyInstance;
  let storage: RedisThrottlerStorage;

  // key, ttl ms, limit, block duration ms, throttler name
  const increment = () =>
    storage.increment('tracker-hash', 60_000, 5, 30_000, 'default');

  beforeEach(() => {
    redis = { isReady: true, eval: jest.fn() };
    fallback = { increment: jest.fn().mockResolvedValue(fallbackRecord) };
    loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    loggerLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    storage = new RedisThrottlerStorage(
      redis as unknown as RedisClient,
      fallback as unknown as ThrottlerStorage,
    );
  });

  afterEach(() => {
    loggerWarn.mockRestore();
    loggerLog.mockRestore();
  });

  describe('shutdown', () => {
    it('lets the in-memory fallback clear its timers', () => {
      const onApplicationShutdown = jest.fn();
      const withHook = new RedisThrottlerStorage(
        redis as unknown as RedisClient,
        { ...fallback, onApplicationShutdown } as unknown as ThrottlerStorage,
      );

      withHook.onApplicationShutdown();

      expect(onApplicationShutdown).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the fallback has no shutdown hook', () => {
      expect(() => storage.onApplicationShutdown()).not.toThrow();
    });
  });

  describe('with Redis available', () => {
    it('counts the hit atomically in Redis with per-throttler keys and string arguments', async () => {
      redis.eval.mockResolvedValue([3, 45_500, 0]);

      await expect(increment()).resolves.toEqual({
        totalHits: 3,
        timeToExpire: 46,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
      expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('INCR'), {
        keys: [
          'throttle:default:tracker-hash',
          'throttle:default:tracker-hash:block',
        ],
        arguments: ['60000', '5', '30000'],
      });
      expect(fallback.increment).not.toHaveBeenCalled();
    });

    it('reports a block with its remaining time in whole seconds', async () => {
      redis.eval.mockResolvedValue([6, 59_001, 30_000]);

      await expect(increment()).resolves.toEqual({
        totalHits: 6,
        timeToExpire: 60,
        isBlocked: true,
        timeToBlockExpire: 30,
      });
    });

    it('never reports negative times (PTTL of a missing key is -2)', async () => {
      redis.eval.mockResolvedValue([0, -2, 1_200]);

      await expect(increment()).resolves.toEqual({
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: 2,
      });
    });
  });

  describe('when Redis fails', () => {
    it('falls back to the in-memory storage with the same arguments and warns once', async () => {
      redis.eval.mockRejectedValue(new Error('READONLY'));

      await expect(increment()).resolves.toBe(fallbackRecord);
      await increment();

      expect(fallback.increment).toHaveBeenCalledTimes(2);
      expect(fallback.increment).toHaveBeenCalledWith(
        'tracker-hash',
        60_000,
        5,
        30_000,
        'default',
      );
      expect(loggerWarn).toHaveBeenCalledTimes(1);
      expect(loggerWarn.mock.calls[0][0]).toContain('READONLY');
    });

    it('describes errors that are not Error instances', async () => {
      redis.eval.mockRejectedValue('timeout');

      await increment();

      expect(loggerWarn.mock.calls[0][0]).toContain('timeout');
    });

    it('falls back when Redis stops answering instead of hanging the request', async () => {
      jest.useFakeTimers();
      try {
        redis.eval.mockReturnValue(new Promise(() => undefined));

        const result = increment();
        await jest.advanceTimersByTimeAsync(500);

        await expect(result).resolves.toBe(fallbackRecord);
        expect(loggerWarn.mock.calls[0][0]).toContain('did not answer');
      } finally {
        jest.useRealTimers();
      }
    });

    it('uses the fallback without calling Redis while it is not connected', async () => {
      redis.isReady = false;

      await expect(increment()).resolves.toBe(fallbackRecord);

      expect(redis.eval).not.toHaveBeenCalled();
      expect(loggerWarn).toHaveBeenCalledTimes(1);
      expect(loggerWarn.mock.calls[0][0]).toContain('Redis is not connected');
    });

    it('logs once when Redis is back, and warns again on the next outage', async () => {
      redis.isReady = false;
      await increment();

      redis.isReady = true;
      redis.eval.mockResolvedValue([1, 60_000, 0]);
      await increment();
      await increment();

      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith('Rate limiting is back on Redis');

      redis.eval.mockRejectedValue(new Error('connection reset'));
      await increment();

      expect(loggerWarn).toHaveBeenCalledTimes(2);
    });

    it('logs nothing while Redis keeps working', async () => {
      redis.eval.mockResolvedValue([1, 60_000, 0]);

      await increment();

      expect(loggerLog).not.toHaveBeenCalled();
      expect(loggerWarn).not.toHaveBeenCalled();
    });

    it('falls back to per-instance memory by default', async () => {
      jest.useFakeTimers();
      try {
        storage = new RedisThrottlerStorage({
          isReady: false,
        } as unknown as RedisClient);

        // Nest's in-memory storage counts the hit per instance
        await expect(
          storage.increment('tracker-hash', 60_000, 5, 30_000, 'default'),
        ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });
});
