import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export function RateLimit(limit: number, ttl: number) {
  return applyDecorators(Throttle({ default: { limit, ttl } }));
}
