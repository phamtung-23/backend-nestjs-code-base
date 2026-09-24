---
paths:
  - "backend/src/**/*.ts"
  - "backend/prisma/schema.prisma"
---

# Cross-cutting concerns

## Request ID & logging

- Target (CLAUDE.md "Foundations status"): middleware takes `X-Request-Id` from the request when it's a valid
  UUID, otherwise generates one; stores it in `AsyncLocalStorage`; echoes it as a response header and in the error
  body; and includes it in every log line.
- Nest `Logger` with a context. Log events, not data dumps. Levels: `error` (5xx, failed jobs), `warn`
  (suspicious activity, auth failures), `log` (lifecycle), `debug` (dev detail).
- Never log secrets or PII (security rule).

## Audit log

- Target model (CLAUDE.md "Foundations status"):

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  action    String
  entity    String
  entityId  String?
  changes   Json?
  ipAddress String?
  userAgent String?
  requestId String?
  createdAt DateTime @default(now())

  @@index([entity, entityId])
  @@index([actorId, createdAt])
  @@map("audit_logs")
}
```

- Record security-relevant and data-changing actions: login success/failure, password change/reset, logout-all,
  role changes, create/update/delete of business entities, admin actions.
- Action names are `<entity>.<past_tense_verb>`: `user.created`, `user.password_changed`, `order.cancelled`.
- `changes` holds only the changed fields (`{ field: { from, to } }`) with secrets removed.
- Write the audit row in the same transaction as the change (`auditService.log(entry, tx)`). Audit logs are
  append-only: no update or delete endpoints.

## Idempotency

- POST endpoints that create resources or trigger side effects (payments, orders, emails) accept an optional
  `Idempotency-Key` header (UUID) via an `@Idempotent()` decorator + `IdempotencyInterceptor` (CLAUDE.md
  "Foundations status").
- Keys are scoped to user (or IP when anonymous) + method + route. Store the request body hash and the response
  (status + body) in Redis for 24 h:
  - same key, same body, finished → replay the stored response with the same status and
    `Idempotent-Replayed: true`
  - same key, different body → 422 `IDEMPOTENCY_KEY_REUSED`
  - same key while the first request is still running → 409 `IDEMPOTENCY_KEY_IN_PROGRESS`
  - store 2xx and 4xx business errors only — never 5xx
- PUT and DELETE are idempotent by design; PATCH with `version` is safe to retry.

## Caching

- `CACHE_MANAGER` is backed by Redis through `@keyv/redis`. Cache read-heavy data only, always with a TTL and a
  `<module>:` key prefix, and invalidate on write. Never store per-user sensitive data under a shared key.
- A cache failure must not fail the request: fall back to the database.

## Health

- `/health` (`VERSION_NEUTRAL`, `@SkipThrottle()`, no auth) pings the database; the Docker healthchecks depend on
  it. Add checks only for hard dependencies.
