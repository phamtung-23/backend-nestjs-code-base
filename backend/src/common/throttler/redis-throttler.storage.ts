import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { RedisClient } from '../../redis/redis.constants';
import { withTimeout } from '../../redis/redis.helpers';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// Fixed window per key, shared by every instance. KEYS[1] counts hits,
// KEYS[2] marks a block. ARGV: window ms, limit, block duration ms.
// Returns { hits, window ms left, block ms left }.
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
-- also repairs a counter left without expiry, which would never reset
if hits == 1 or redis.call('PTTL', KEYS[1]) == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  -- the next window starts fresh once the block ends
  redis.call('DEL', KEYS[1])
  return { hits, ttl, tonumber(ARGV[3]) }
end
return { hits, ttl, 0 }
`;

const toSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

// Throttler storage in Redis so limits hold across instances. If Redis is
// unavailable or slow to answer, it falls back to per-instance memory: rate
// limiting degrades, requests keep working.
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private usingFallback = false;

  constructor(
    private readonly redis: RedisClient,
    private readonly fallback: ThrottlerStorage = new ThrottlerStorageService(),
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.isReady) {
      try {
        const [hits, windowMs, blockMs] = (await withTimeout(
          this.redis.eval(INCREMENT_SCRIPT, {
            keys: [
              `throttle:${throttlerName}:${key}`,
              `throttle:${throttlerName}:${key}:block`,
            ],
            arguments: [String(ttl), String(limit), String(blockDuration)],
          }),
        )) as [number, number, number];
        this.recovered();
        return {
          totalHits: hits,
          timeToExpire: toSeconds(windowMs),
          isBlocked: blockMs > 0,
          timeToBlockExpire: toSeconds(blockMs),
        };
      } catch (error) {
        this.degraded(error);
      }
    } else {
      this.degraded(new Error('Redis is not connected'));
    }
    return this.fallback.increment(
      key,
      ttl,
      limit,
      blockDuration,
      throttlerName,
    );
  }

  // The in-memory fallback keeps a timer per hit; let it clear them
  onApplicationShutdown(): void {
    (this.fallback as Partial<OnApplicationShutdown>).onApplicationShutdown?.();
  }

  private degraded(error: unknown): void {
    if (!this.usingFallback) {
      this.usingFallback = true;
      this.logger.warn(
        `Rate limiting falls back to per-instance memory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private recovered(): void {
    if (this.usingFallback) {
      this.usingFallback = false;
      this.logger.log('Rate limiting is back on Redis');
    }
  }
}
