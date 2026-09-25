import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInterceptor,
} from './idempotency.interceptor';

// For POST endpoints that create resources or trigger side effects. Document
// the responses it adds on the route itself, next to the route's other codes
// for the same statuses: 400 IDEMPOTENCY_KEY_INVALID, 409
// IDEMPOTENCY_KEY_IN_PROGRESS, 422 IDEMPOTENCY_KEY_REUSED and 503
// SERVICE_UNAVAILABLE (Redis down while a key was sent).
export function Idempotent() {
  return applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: IDEMPOTENCY_HEADER,
      required: false,
      description:
        'Optional random key per operation (8-255 chars; use a UUID v4, never a predictable value). Retries with ' +
        'the same key and body replay the first response (header Idempotent-Replayed: true) instead of running again.',
    }),
  );
}
