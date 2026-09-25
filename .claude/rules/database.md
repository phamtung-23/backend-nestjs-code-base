---
paths:
  - "backend/prisma/**"
  - "backend/src/**/*.service.ts"
  - "backend/src/**/*.repository.ts"
  - "backend/src/prisma/**"
---

# Database (Prisma + PostgreSQL)

## Schema conventions

- Models are PascalCase singular, mapped to snake_case plural tables (`@@map("order_items")`); fields stay
  camelCase (existing convention).
- IDs: `String @id @default(cuid())`. Every model has `createdAt DateTime @default(now())` and
  `updatedAt DateTime @updatedAt`, except append-only logs.
- Aggregates that users edit concurrently get `version Int @default(0)` for optimistic locking.
- Hard delete by default. Soft delete (`deletedAt DateTime?`) only when the domain needs it, and then the
  repository filters it everywhere.
- Every relation declares `onDelete`.
- Index every FK column and every column used by list filters or sorts, as composite indexes in query order
  (`@@index([ownerId, createdAt])`). Don't add `@@index` on a column that is already `@unique`.
- Money: `Decimal @db.Decimal(p, s)` or `Int` minor units — never `Float`.

## Migrations

- Change `schema.prisma`, then create a new migration with the `/db-migration` skill. Committed migrations are
  immutable (a PreToolUse hook blocks edits).
- Review the SQL. Destructive changes (DROP, type narrowing, NOT NULL on a populated table) need an
  expand → backfill → contract plan across releases.
- Containers run `prisma migrate deploy` on start, so every migration must stay compatible with the version that
  is still running and with a rollback to it. Reference: `20260925000000_hash_refresh_tokens` (expand: new column,
  old one kept nullable) and `20260924000100_lowercase_user_emails` (data fix that can't fail + `NOT VALID` check).
- A data migration that could fail on existing rows must not run after destructive steps of the same release; make
  it unable to fail, and document the manual follow-up in the migration.
- Prisma runs a migration file as one transaction, so the first `ALTER TABLE` holds its ACCESS EXCLUSIVE lock
  until the file ends. On populated tables: never `ADD COLUMN ... DEFAULT <volatile>` (`gen_random_uuid()`,
  `random()` — rewrites the whole table); add the column nullable, set the default for new rows, backfill in
  batches in a later step, then `NOT NULL` via a validated `CHECK ... NOT VALID`. Avoid full-table `UPDATE`s in the
  same file as DDL. `CREATE INDEX CONCURRENTLY` needs a migration of its own.
- `prisma/seed.ts` is for dev data only.

## Queries

- Access Prisma through the module repository (reference: `modules/users/users.repository.ts`). Services use
  `PrismaService` only for `$transaction`.
- Always `select` what the caller needs (share select constants). Fetch `password` / secret columns only in
  credential checks.
- **No queries inside loops (N+1).** Use nested `select`/`include` (Prisma batches relation loads),
  `where: { id: { in: ids } }` plus an in-memory map, or `_count` for counts.
- `include` is whitelisted, depth ≤ 1 by default, and nested lists are bounded with `take` and `select`.
- Lists are always paginated: offset lists use `prisma.$transaction([findMany, count])`; ordering is stable with
  an `id` tiebreaker. Cursor lists use the keyset helpers in `src/common/query/cursor.helpers.ts` (reference:
  `AuditService.list`), never Prisma's `cursor: { id }, skip: 1`: Postgres can't turn Prisma's cursor condition into
  an index range (every deep page scans all earlier rows) and a deleted cursor row silently returns an empty page.
  The keyset `where` (`field <= v AND (field < v OR (field = v AND id < cursorId))`) is an `Index Cond` on the
  sort field's index (measured: 0.04 ms at depth 600k of 1M rows). The sort field must be non-nullable and
  indexed, alone or after the list's equality filters (`@@index([actorId, createdAt])`).
- Case-insensitive search: `{ contains: term, mode: 'insensitive' }`. On large tables, add a pg_trgm GIN index or
  full-text search in a migration.

## Transactions

```ts
await this.prisma.$transaction(async (tx) => {
  const user = await this.usersRepository.create(data, tx);
  await this.auditService.log({ action: 'user.created', entityId: user.id }, tx);
});
await this.mailService.sendWelcome(user.email); // side effects after commit
```

- Any operation with more than one write that must succeed together uses an interactive transaction.
- Keep transactions short: no emails, HTTP calls, queues or bcrypt inside. Do side effects after commit, or write
  to an outbox table when they must not be lost.
- Repository methods take `tx?: Prisma.TransactionClient` and use `(tx ?? this.prisma)`.
- Set `timeout` / `isolationLevel` explicitly when you need Serializable, and handle P2034 (retry once or 409).

## Concurrency

- DB constraints enforce uniqueness — a pre-check is fine for a friendly error, but still catch P2002 → 409
  (`isPrismaError(error, 'P2002')` from `src/common/helpers/prisma.helpers.ts`; see `RegistrationService.register`).
- State transitions use atomic conditional writes (reference: `OtpRepository.registerAttempt` / `markUsed`, `RefreshTokenRepository.revokeIfActive`):

```ts
const { count } = await tx.order.updateMany({
  where: { id, status: 'PENDING' },
  data: { status: 'PAID' },
});
if (count === 0) {
  throw new ConflictException({ errorCode: OrderErrorCode.STATE_CHANGED, message: 'Order was modified' });
}
```

- Optimistic locking for user-edited resources: the client sends `version` (or `If-Match`), the update uses
  `where: { id, version }` with `data: { ..., version: { increment: 1 } }`, and `count === 0` → 409
  `VERSION_CONFLICT` (412 when driven by `If-Match`).
- Counters use `{ increment: n }`, never read-modify-write.
- Pessimistic locks (`SELECT ... FOR UPDATE` via `$queryRaw` inside a transaction) only when a conditional update
  can't express the invariant — e.g. "revoke all of a user's tokens" vs. "insert a token" under READ COMMITTED
  (reference: `UsersRepository.lockForUpdate`, used by every session-issuing/revoking transaction).
- Housekeeping deletes run in batches outside a transaction (reference: `OtpRepository.deleteStale`).

## Performance

- Check `EXPLAIN ANALYZE` for new list queries against realistic data volumes.
- Cache read-heavy, rarely changing data with `CACHE_MANAGER` (Redis): explicit TTL, `<module>:<entity>:<id>`
  keys, invalidate on write.
- Avoid a `count` per request on huge tables — use cursor pagination there (reference: `GET /v1/audit-logs`).
- Tune `connection_limit` in `DATABASE_URL` for the deployment's concurrency.
