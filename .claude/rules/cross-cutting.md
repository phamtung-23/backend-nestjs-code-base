---
paths:
  - "backend/src/**/*.ts"
  - "backend/prisma/schema.prisma"
---

# Cross-cutting concerns

## Request ID & logging

- `requestIdMiddleware` (registered in `src/app.setup.ts`, before the body parser) always generates the id on the
  server — never trust a client-supplied one, or callers could mix their log lines and audit rows with someone
  else's — echoes it as the `X-Request-Id` response header, and stores it in `RequestContext` (AsyncLocalStorage). The error body carries it, and `AppLogger` appends `[req <id>]` to every log
  line written during the request. Read it anywhere with `RequestContext.requestId()`; don't pass it through
  function arguments.
- Nest `Logger` with a context. Log events, not data dumps. Levels: `error` (5xx, failed jobs), `warn`
  (suspicious activity, auth failures), `log` (lifecycle), `debug` (dev detail).
- Never log secrets or PII (security rule).

## Audit log

- `AuditModule` is global: inject `AuditService` and call `auditService.log(entry, tx)` inside the transaction of
  the change it records, so both commit or neither does. IP, user agent and request id come from `RequestContext`.
- Actions are constants named `<entity>.<past_tense_verb>` — core ones in `AuditAction` (`modules/audit/audit.constants.ts`), a module's own in its `<name>.constants.ts` (`<Module>AuditAction`):
  `user.registered`, `user.password_changed`, `session.started`. Add new ones there; never rename existing ones.
- Record security-relevant and data-changing actions: logins (and failed logins of existing accounts), password
  change/reset, sessions revoked, role changes, create/update/delete of business entities, admin actions.
- `changes` holds only changed fields (`{ field: { from, to } }`) with secrets removed; `metadata` holds context
  that isn't a change (`{ method: 'password' }`). Never put passwords, tokens or codes in either.
- An event that must not slow the response (e.g. a failed login, which would otherwise reveal that the account
  exists) is logged in the background instead of inside a transaction.
- The table has no foreign keys (entries outlive what they mention) and is append-only: no update/delete
  endpoints. Admins read it through `GET /v1/audit-logs` (filters, sort by `createdAt`, pagination, fields; no
  `search`: `action` is low-cardinality). Its exact `total` counts scan; a high-volume project should move this list
  to cursor pagination.
- Retention: `AuditRetentionTask` deletes entries older than `AUDIT_RETENTION_DAYS` (365 — a legal decision, set
  it per project) every night in batches. Housekeeping, not an API.

## Idempotency

- Put `@Idempotent()` (`src/common/idempotency`) on POST endpoints that create resources or trigger side effects
  (reference: `POST /v1/auth/register`). Clients may send `Idempotency-Key` (8–255 of `A-Z a-z 0-9 - _`), a
  random UUID v4 per operation — anonymous callers are scoped by IP, so a predictable key can be pre-claimed by
  someone behind the same NAT.
- Keys are scoped to the caller (user id, or IP when anonymous) and the handler; the request fingerprint covers the
  URL (path ids, query) and the body. It is an HMAC keyed from `JWT_SECRET` (HKDF), because bodies carry passwords
  and a plain hash in Redis could be cracked offline; rotating `JWT_SECRET` turns retries of in-flight keys into
  422s for up to 24 h. The first request claims the key in Redis (`SET NX`, 60 s while processing); its outcome is
  stored for 24 h:
  - same key, same body, finished → the stored response is replayed (same status) with `Idempotent-Replayed: true`
  - same key, different body → 422 `IDEMPOTENCY_KEY_REUSED`
  - same key while the first request is still running → 409 `IDEMPOTENCY_KEY_IN_PROGRESS`
  - 2xx bodies and `HttpException` 4xx errors thrown by the handler are stored
  - validation failures (`VALIDATION_FAILED` — pipes run inside interceptors) are not: nothing ran, so the client
    can fix the body and reuse the key, and attacker-sized error details never reach Redis
  - 5xx and other errors (including database errors the filter maps to 404/409) release the key so the client can
    retry
  - Redis unavailable or not answering within 500 ms (`withTimeout`) and a key was sent → 503 (never risk running
    twice)
- Document 400 `IDEMPOTENCY_KEY_INVALID`, 409 `IDEMPOTENCY_KEY_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED` and 503
  `SERVICE_UNAVAILABLE` on the route, next to its other codes for those statuses.
- Trade-offs: a handler running longer than the 60 s claim can be started again by a retry, so keep idempotent
  handlers fast (or raise the claim for that route); the stored response body (which may contain personal data)
  sits in Redis for 24 h.
- PUT and DELETE are idempotent by design; PATCH with `version` is safe to retry.

## Caching

- `CACHE_MANAGER` is backed by Redis through `@keyv/redis`. Cache read-heavy data only, always with a TTL and a
  `<module>:` key prefix, and invalidate on write. Never store per-user sensitive data under a shared key.
- Redis runs with `maxmemory 192mb` and `volatile-lru` (`docker-compose.yml`): only keys with a TTL can be
  evicted, so every key written to Redis must have one.
- A cache failure must not fail the request: fall back to the database.

## Health

- `/health` (`VERSION_NEUTRAL`, `@SkipThrottle()`, no auth) pings the database; the Docker healthchecks depend on
  it. Add checks only for hard dependencies.
