# Backend Base — NestJS API starter

Reusable NestJS backend that gets cloned at the start of new projects. Everything added here must be
generic (no project-specific business logic) and must follow the standards in `.claude/rules/`.

## Communication

- Reply to the user in Vietnamese. Write code, comments, commit messages and docs in English.

## Stack

NestJS 11 (Express 5) · TypeScript strict · Prisma 6 + PostgreSQL 16 · Redis 7 (cache via `@keyv/redis`) ·
JWT via passport-jwt (access + rotating refresh) · `@nestjs/throttler` · class-validator · Swagger · Jest ·
Docker (multi-stage) + Traefik v3 · GitHub Actions

## Layout

```text
backend/                  NestJS app — run every yarn/npx command from here
  prisma/                 schema.prisma, migrations/ (immutable once committed), seed.ts
  src/main.ts             bootstrap: create app, AppLogger, setupApp, listen
  src/app.setup.ts        app wiring: trust proxy, request id, helmet, CORS, ValidationPipe, versioning, Swagger
  src/app.module.ts       global modules (ConfigModule + env validation) + APP_GUARD / APP_INTERCEPTOR / APP_FILTER
  src/config/             env.validation.ts — every env var, validated at startup
  src/common/             generic building blocks: constants, context, decorators, filters, helpers,
                          interceptors, logger, middleware, pipes, query
  src/prisma/             PrismaService (global module)
  src/modules/<name>/     one folder per bounded context (auth, mail, health, ...)
docker-compose.yml        base stack; docker-compose.override.yml is auto-loaded for local dev
docker-compose.{dev,prod,prod-ip}.yml   dev server / production / IP-only production overrides
traefik/                  static + dynamic Traefik config per environment (strips /api before the app)
.github/workflows/        dev.yml: lint + format + build + test on PR, SSH deploy on push to dev
```

## Commands (from `backend/`)

| Task | Command |
| --- | --- |
| Dev server | `yarn start:dev` |
| Quality gate | `yarn lint:check && yarn format:check && yarn build && yarn test:cov` (or the `/verify` skill) |
| Prisma client / validate | `npx prisma generate` · `npx prisma validate` |
| Migrations | `yarn db:migrate:dev` (dev, needs DB) · `yarn db:migrate` (deploy) — see `/db-migration` skill |
| Seed | `yarn db:seed` |
| Local stack | `docker compose up -d` from the repo root (reads `.env`; template `.env.sample`) |

## Definition of done

Before reporting a code task as finished, run the quality gate and report the real results (lint, format,
build, tests with ≥95% coverage). In addition:

- Schema changed → a new migration exists and was reviewed (`/db-migration`).
- Endpoint added/changed → Swagger decorators and DTO docs updated; run the `api-standards-reviewer` agent.
- Auth, guards, secrets, CORS or rate limits touched → run the `security-reviewer` agent.
- Prisma queries, transactions or schema touched → run the `database-reviewer` agent.
- New env var → added to `.env.sample`, `backend/.env.example`, every `docker-compose*.yml` backend
  `environment` block, and startup config validation.

## Non-negotiables (details in `.claude/rules/`)

- Routes live under `/v{n}` (URI versioning); only infra endpoints such as `/health` are version-neutral.
- Every success response uses the envelope; every error goes through `GlobalExceptionFilter` with a stable
  `errorCode`.
- Every input is a DTO validated by the global `ValidationPipe`; no `any` in exported signatures.
- Every list endpoint is paginated (max `limit` 100) and whitelists sort / filter / fields / include.
- Multi-write operations run in `prisma.$transaction`; no emails or HTTP calls inside a transaction.
- Never return or log secrets: password hashes, tokens, OTP codes, SMTP credentials.
- Never edit a committed migration — create a new one (a PreToolUse hook enforces this).
- Never commit `.env` files or real credentials; samples contain placeholders only.
- Don't copy patterns from the legacy code listed under "Known deviations".

## Foundations status

The rules reference shared building blocks, and some don't exist yet. Before relying on a block marked ❌,
build it with tests, following the referenced rule and
`.claude/skills/new-resource/reference/foundations.md`, then update this table in the same change.
`src/app.setup.ts` applies all app-level wiring (middleware, CORS, pipes, versioning, Swagger) for `main.ts` and
future e2e tests.

| Building block | Status | Rule |
| --- | --- | --- |
| Response envelope (`ResponseInterceptor`, `ResponseHelper`) | ✅ (detects envelopes heuristically) | api-design |
| URI versioning, `/health` (version-neutral, DB ping) | ✅ | api-design |
| Global rate limit (`ThrottlerGuard`, in-memory storage) | ✅ (Redis storage ❌) | security |
| Refresh tokens: separate secret, `jti`, SHA-256 hash at rest, atomic rotation, revoked on password change/reset | ✅ | security |
| OTP attempt limit via conditional update | ✅ | security |
| Error format with `errorCode` / `details` / `requestId`, Prisma error mapping, 5xx logging (`GlobalExceptionFilter`, `validationExceptionFactory`) | ✅ | errors |
| List query helpers: `ListQueryDto`, `ProjectionQueryDto`, `parseSort` / `buildSelect` / `buildSearch` / `pageMeta` (`src/common/query`), DTO transform helpers | ✅ offset pagination (no module uses them yet); cursor helpers ❌ | api-design |
| Swagger decorators for the envelope: `ApiEnvelopeResponse`, `ApiErrorResponse` | ✅ | api-design |
| Secure-by-default auth: global `JwtAuthGuard` + `@Public()`, `@CurrentUser()`, `@ClientMetaParam()` | ✅ | security |
| RBAC: `@Roles()` + `RolesGuard`; `isActive` enforced on every request | ✅ | security |
| CORS from `ALLOWED_ORIGINS`, helmet, `SWAGGER_ENABLED` flag (`src/app.setup.ts`) | ✅ | security |
| Startup env validation (`src/config/env.validation.ts`) | ✅ | architecture |
| Typed config namespaces (`registerAs`) | ❌ (code reads `ConfigService.get('KEY')`) | architecture |
| Request ID (`X-Request-Id`, `RequestContext`) + log correlation (`AppLogger`) | ✅ | cross-cutting |
| Audit log (`AuditLog` model + `AuditService`) | ❌ | cross-cutting |
| Idempotency (`@Idempotent()` + `IdempotencyInterceptor`) | ❌ | cross-cutting |
| Repository layer (`users`, auth `otp` / `refresh-token` repositories) | ✅ | architecture |
| Scheduled housekeeping (`@nestjs/schedule`, `AuthCleanupTask`, batched deletes) | ✅ | database |
| e2e test setup (`backend/test`) | ❌ | testing |

## Known deviations (legacy — fix when touching, never copy)

- `MailService` logs recipient email addresses in full, keeps HTML templates inline, and depends on nodemailer
  directly instead of a port.
- `ResponseInterceptor` treats any object with `status` and `message` keys as an envelope; return data through
  `ResponseHelper` or DTOs that don't have both keys.
- Email verification isn't required to log in; enforce it in `AuthService.login` if a project needs it (see "Known
  gaps" in `backend/documents/AUTHENTICATION.md`).
- `refresh_tokens.token` (plaintext, nullable, unused) is the pending contract step of the expand/contract migration
  `20260925000000_hash_refresh_tokens`: once no deployment can roll back past it, add a migration that drops `token`
  and makes `tokenHash` required.
- Accounts whose emails differed only by case before `20260924000100_lowercase_user_emails` are left untouched and
  can't log in until merged by hand (query in the migration file).
