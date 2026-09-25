import { createClient } from 'redis';

// Shared connection for features that need Redis primitives (rate limiting,
// idempotency). The cache (CACHE_MANAGER) keeps its own Keyv connection.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type RedisClient = ReturnType<typeof createClient>;
