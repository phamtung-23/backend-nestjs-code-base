import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createClient } from 'redis';
import { RedisConfig, redisConfig } from '../config/redis.config';
import { REDIS_CLIENT, RedisClient } from './redis.constants';

const MAX_RECONNECT_DELAY_MS = 5000;

export function createRedisClient(config: RedisConfig): RedisClient {
  const logger = new Logger('Redis');
  const client = createClient({
    socket: {
      host: config.host,
      port: config.port,
      reconnectStrategy: (retries) =>
        Math.min(retries * 200, MAX_RECONNECT_DELAY_MS),
    },
    password: config.password || undefined,
    // Fail fast while disconnected instead of queueing commands: callers fall
    // back (rate limiting) or answer 503 (idempotency) rather than hang
    disableOfflineQueue: true,
  });

  // Log state changes, not every reconnect attempt
  let healthy = true;
  client.on('error', (error: Error) => {
    if (healthy) {
      healthy = false;
      logger.warn(`Connection lost: ${error.message}`);
    }
  });
  client.on('ready', () => {
    healthy = true;
    logger.log('Connected');
  });

  // Not awaited: the app starts (and serves what doesn't need Redis) while
  // the client keeps reconnecting in the background
  client.connect().catch((error: Error) => {
    logger.warn(`Initial connection failed: ${error.message}`);
  });
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: createRedisClient,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis.isOpen) {
      return;
    }
    // A client stuck reconnecting has nothing to flush; don't wait on it
    if (this.redis.isReady) {
      await this.redis.close();
    } else {
      this.redis.destroy();
    }
  }
}
