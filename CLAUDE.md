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
  src/main.ts             bootstrap: trust proxy, CORS, ValidationPipe, URI versioning, Swagger at /docs
  src/app.module.ts       global modules + APP_GUARD / APP_INTERCEPTOR / APP_FILTER
  src/common/             generic building blocks (envelope, exception filter, helpers, ...)
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

| Building block | Status | Rule |
| --- | --- | --- |
| Response envelope (`ResponseInterceptor`, `ResponseHelper`) | ✅ (detects envelopes heuristically) | api-design |
| URI versioning, `/health` (version-neutral, DB ping) | ✅ | api-design |
| Global rate limit (`ThrottlerGuard`, in-memory storage) | ✅ (Redis storage ❌) | security |
| Refresh-token rotation, separate secrets, `jti` | ✅ (tokens stored in plain text ❌) | security |
| OTP attempt limit via conditional update | ✅ | security |
| Error format with `errorCode`, `requestId`, Prisma error mapping, 5xx logging | ❌ | errors |
| List query helpers: `ListQueryDto`, sort / fields / include / search parsing (`src/common/query`) | ❌ | api-design |
| Secure-by-default auth: global `JwtAuthGuard` + `@Public()`, `@CurrentUser()` | ❌ | security |
| RBAC: `@Roles()` + `RolesGuard`; `isActive` check | ❌ | security |
| CORS from `ALLOWED_ORIGINS`, helmet, Swagger off in prod | ❌ | security |
| Startup env validation + typed config namespaces | ❌ | architecture |
| Request ID (`X-Request-Id`) + log correlation | ❌ | cross-cutting |
| Audit log (`AuditLog` model + `AuditService`) | ❌ | cross-cutting |
| Idempotency (`@Idempotent()` + `IdempotencyInterceptor`) | ❌ | cross-cutting |
| Repository layer | ❌ (auth calls Prisma directly) | architecture |
| e2e test setup (`backend/test`) | ❌ | testing |

## Known deviations (legacy — fix when touching, never copy)

- `modules/auth`: token fields are snake_case (`access_token`), the service returns `{ message }` objects,
  POST actions return 201, a duplicate on register returns 401 (should be 409), 404s on public endpoints leak
  whether an account exists, per-parameter `new ValidationPipe()` duplicates the global pipe, and
  `AuthService` mixes tokens, OTP, passwords and user lookup (split it per SRP).
- Password DTOs use `MinLength(6)` without `MaxLength` (standard: 8–72 characters).
- `register`, `verifyEmail` and `resetPassword` do several writes without a transaction; password
  change/reset doesn't revoke refresh tokens.
- `refresh_tokens.token` has both `@unique` and a redundant `@@index`.
- `GET /v1` returns "Hello World!" (starter leftover).
