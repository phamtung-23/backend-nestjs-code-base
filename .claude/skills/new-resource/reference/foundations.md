# Foundations — shared building blocks

The rules and the `new-resource` templates depend on these pieces. Check CLAUDE.md "Foundations status" first;
build whatever a task needs that is still ❌, **with unit tests**, then flip its row to ✅ in the same change.

## 1–4. Common building blocks — in the repo (source of truth: read the files)

| Piece | File |
| --- | --- |
| Error codes + status fallback map | `backend/src/common/constants/error-codes.ts` |
| DTO transform helpers (`trimString`, `normalizeEmail`, `toArray`, `toBoolean`) | `backend/src/common/helpers/transform.helpers.ts` |
| List query contract (`ListQueryDto`, `ProjectionQueryDto`, `parseSort`, `buildSelect` + `IncludeSpec`, `buildSearch`, `pageMeta`) | `backend/src/common/query/` |
| Pagination meta with `totalPages` | `ResponseHelper.paginated` in `backend/src/common/helpers/response.helper.ts` |
| Swagger decorators (`ApiEnvelopeResponse`, `ApiErrorResponse`) | `backend/src/common/decorators/` |
| Error format, Prisma mapping, 5xx logging | `backend/src/common/filters/global-exception.filter.ts`, `backend/src/common/pipes/validation-exception.factory.ts` |
| Request ID + log correlation | `backend/src/common/middleware/request-id.middleware.ts`, `backend/src/common/context/request-context.ts`, `backend/src/common/logger/app.logger.ts` |
| Env validation | `backend/src/config/env.validation.ts` |
| CORS, helmet, `SWAGGER_ENABLED`, pipes, versioning | `backend/src/app.setup.ts` |

Section 6 lists pieces that are specified but not written yet.

## 5. Auth building blocks — in the repo

| Piece | File |
| --- | --- |
| `@Public()` + global `JwtAuthGuard` | `backend/src/modules/auth/decorators/public.decorator.ts`, `guards/jwt-auth.guard.ts` |
| `@Roles()` + global `RolesGuard` | `backend/src/modules/auth/decorators/roles.decorator.ts`, `guards/roles.guard.ts` |
| `@CurrentUser()` (→ `PublicUser`) | `backend/src/modules/auth/decorators/current-user.decorator.ts` |
| `@ClientMetaParam()` (→ `ClientMeta`: user agent, IP) | `backend/src/common/decorators/client-meta.decorator.ts` |
| Guard registration order (Throttler → JwtAuth → Roles) | `backend/src/app.module.ts` |

## 6. Specified, not yet written

Implement each one following its rule, with tests, then update CLAUDE.md.

| Piece | Where | Spec |
| --- | --- | --- |
| Typed config namespaces | `src/config/*.config.ts` with `registerAs` | group settings (`auth`, `redis`, `mail`, ...) and inject them with `ConfigType<typeof authConfig>` instead of `ConfigService.get('KEY')`. |
| Audit log | `modules/audit/` (`AuditService.log(entry, tx?)`) + `AuditLog` model + migration | `.claude/rules/cross-cutting.md`. |
| Idempotency | `common/decorators/idempotent.decorator.ts` + `common/interceptors/idempotency.interceptor.ts` (Redis via `CACHE_MANAGER` or a dedicated client with `SET NX`) | `.claude/rules/cross-cutting.md`. |
| Redis throttler storage | `ThrottlerModule.forRootAsync` with a Redis storage adapter | needed before running more than one instance. |
| OTP codes hashed | `OtpService` + migration + new `OTP_SECRET` env var | store `HMAC-SHA256(OTP_SECRET, code)`, compare with `timingSafeEqual`; plain SHA-256 of 6 digits is brute-forceable. |
| Refresh token reuse detection | `TokenService.rotate` | reuse of an already-rotated token revokes the user's whole token family (mind legit concurrent refreshes from several tabs). |
| e2e setup | `backend/test/jest-e2e.json`, `test/*.e2e-spec.ts` | `.claude/rules/testing.md`; bootstrap the app with `setupApp(app)` from `src/app.setup.ts` so tests match production wiring. |
