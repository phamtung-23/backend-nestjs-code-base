import { ConfigType, registerAs } from '@nestjs/config';
import { readEnv } from './env.validation';

export const redisConfig = registerAs('redis', () => {
  const env = readEnv();
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  };
});

export type RedisConfig = ConfigType<typeof redisConfig>;
