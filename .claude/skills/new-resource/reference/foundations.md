# Foundations — shared building blocks

The rules and the `new-resource` templates depend on these pieces. Check CLAUDE.md "Foundations status" first;
build whatever a task needs that is still ❌, **with unit tests**, then flip its row to ✅ in the same change.

## 1–4. Common building blocks — in the repo (source of truth: read the files)

| Piece | File |
| --- | --- |
| Error codes + status fallback map | `backend/src/common/constants/error-codes.ts` |
| DTO transform helpers (`trimString`, `normalizeEmail`, `toArray`, `toBoolean`, `toDate`, `toEndOfDay`) | `backend/src/common/helpers/transform.helpers.ts` |
| List query contract (`ListQueryDto`, `CursorListQueryDto`, `ProjectionQueryDto`, `parseSort`, `buildSelect` + `IncludeSpec`, `buildSearch`, `pageMeta`, keyset `parseCursorSort` / `cursorWhere` / `cursorOrderBy` / `cursorSelect` / `cursorPage`) | `backend/src/common/query/` |
| Envelopes: `SuccessEnvelope`, `ResponseHelper.success` / `paginated` (with `totalPages`) / `cursorPaginated` | `backend/src/common/helpers/response.helper.ts` |
| Typed config namespaces (`appConfig`, `authConfig`, `mailConfig`, `redisConfig`) | `backend/src/config/*.config.ts` |
| Mail port (`MAIL_SENDER`, `MailSender`, `SmtpMailSender`, templates) | `backend/src/modules/mail/` |
| `runInBackground`, `maskEmail` | `backend/src/common/helpers/background.helper.ts`, `mask.helpers.ts` |
| Swagger decorators (`ApiEnvelopeResponse`, `ApiErrorResponse`) | `backend/src/common/decorators/` |
| Error format, Prisma mapping, 5xx logging | `backend/src/common/filters/global-exception.filter.ts`, `backend/src/common/pipes/validation-exception.factory.ts` |
| Request ID + log correlation | `backend/src/common/middleware/request-id.middleware.ts`, `backend/src/common/context/request-context.ts`, `backend/src/common/logger/app.logger.ts` |
| Env validation | `backend/src/config/env.validation.ts` |
| CORS, helmet, `SWAGGER_ENABLED`, pipes, versioning | `backend/src/app.setup.ts` |
| Audit log (`AuditService.log(entry, tx)`, `AuditAction`, admin list endpoint) | `backend/src/modules/audit/` |
| Idempotency (`@Idempotent()`) | `backend/src/common/idempotency/` |
| Shared Redis client (`REDIS_CLIENT`) + Redis throttler storage | `backend/src/redis/`, `backend/src/common/throttler/` |
| e2e harness (`createTestApp`, `FakeMailbox`, testcontainers setup) | `backend/test/utils/`, `backend/test/setup/` |

Section 6 lists pieces that are specified but not written yet (none at the moment).

## 5. Auth building blocks — in the repo

| Piece | File |
| --- | --- |
| `@Public()` + global `JwtAuthGuard` | `backend/src/modules/auth/decorators/public.decorator.ts`, `guards/jwt-auth.guard.ts` |
| `@Roles()` + global `RolesGuard` | `backend/src/modules/auth/decorators/roles.decorator.ts`, `guards/roles.guard.ts` |
| `@CurrentUser()` (→ `PublicUser`) | `backend/src/modules/auth/decorators/current-user.decorator.ts` |
| `@ClientMetaParam()` (→ `ClientMeta`: user agent, IP) | `backend/src/common/decorators/client-meta.decorator.ts` |
| Guard registration order (Throttler → JwtAuth → Roles) | `backend/src/app.module.ts` |

## 6. Specified, not yet written

Nothing at the moment. When a rule references a piece that doesn't exist, add it here with its spec, mark it ❌ in
CLAUDE.md "Foundations status", and build it with tests before relying on it.
