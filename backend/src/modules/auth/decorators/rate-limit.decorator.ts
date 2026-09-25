import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiErrorResponse } from '../../../common/decorators/api-error-response.decorator';

// Stricter per-route limit (per client IP), documented in Swagger as a 429
export function RateLimit(limit: number, ttl: number) {
  return applyDecorators(
    Throttle({ default: { limit, ttl } }),
    ApiErrorResponse(429, 'RATE_LIMITED'),
  );
}
