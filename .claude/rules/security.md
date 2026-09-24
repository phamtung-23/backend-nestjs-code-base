---
paths:
  - "backend/src/**/*.ts"
  - "docker-compose*.yml"
  - "traefik/**"
  - ".env.sample"
  - "backend/.env.example"
---

# Security

## Authentication

- Access token: JWT Bearer signed with `JWT_SECRET`. Refresh token: signed with `JWT_REFRESH_SECRET`, carries
  `type: 'refresh'` and a random `jti`, stored in `refresh_tokens`, rotated on every refresh. `JwtStrategy`
  rejects refresh tokens. Keep all of that intact.
- Target (CLAUDE.md "Foundations status"): secure by default — `JwtAuthGuard` registered as `APP_GUARD`, open
  endpoints opt out with `@Public()`. Until that exists, every non-public route needs
  `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth('JWT-auth')`.
- Read the current user with a `@CurrentUser()` param decorator, not `@Request() req`.
- Token lifetimes come from config (target: access 15 min, refresh 7 days); don't hardcode new ones.
- Every authenticated request checks that the user exists and `isActive`. Password change/reset revokes all of the
  user's refresh tokens.
- Passwords: bcryptjs async API with cost ≥ 10. Select the `password` column only in credential-check queries;
  never log or return it.
- OTP: `crypto.randomInt`, short TTL, single use, scoped by type, attempt limit via a conditional update
  (reference: `AuthService.consumeOtp`).
- Public endpoints never reveal whether an account exists (follow the `forgotPassword` pattern: same response
  either way).

## Authorization

- RBAC: `@Roles(UserRole.ADMIN)` + `RolesGuard` (build it if missing). New admin endpoints default to ADMIN only.
- Ownership: services scope queries to the caller (`where: { id, ownerId: user.id }`) and return 404 when there's
  no match. Never derive ownership from IDs in the request body.
- Clients can never set roles or other privileged fields.

## Rate limiting

- Global `ThrottlerGuard` (`APP_GUARD`), default 100 req/min per IP; `trust proxy` = 1 because Traefik sits in
  front and overwrites `X-Forwarded-For`. If another proxy/CDN is ever added in front of Traefik, raise the hop count
  in `src/app.setup.ts`, or every client shares one rate-limit bucket.
- Stricter `@RateLimit(limit, ttlMs)` on login, register, OTP send/verify, forgot/reset password, and anything
  that sends email/SMS or is expensive. `@SkipThrottle()` only on health/metrics.
- Multiple instances need Redis-backed throttler storage (CLAUDE.md "Foundations status").

## CORS, headers, docs

- `src/app.setup.ts` owns this. Allowed origins come from `ALLOWED_ORIGINS` (exact origins, comma-separated; env
  validation rejects wildcards and paths). With none configured: localhost origins in development, CORS off in
  production. `X-Request-Id` is exposed to browsers. Never `*` together with `credentials: true`.
- helmet sets security headers on every response; only `/docs` skips the CSP because Swagger UI needs inline
  scripts. Traefik adds HSTS and frame headers in production.
- Swagger UI follows `SWAGGER_ENABLED` (default: on outside production, off in production).
- In production, env validation refuses to start with JWT secrets shorter than 32 characters, equal to each other,
  or still containing sample placeholder text.

## Secrets & sensitive data

- Secrets only come from env; `.env` is never committed; `.env.sample` / `backend/.env.example` hold placeholders.
- Never log tokens, passwords, OTP codes, `Authorization` headers or full card numbers; mask emails in logs where
  practical.
- Response DTOs whitelist fields; secret columns never leave the repository except for the specific auth check.
- Refresh tokens should be stored hashed (SHA-256) — CLAUDE.md "Foundations status".
- Raw SQL only through tagged `$queryRaw\`...\``; `$queryRawUnsafe` / `$executeRawUnsafe` with user input are
  forbidden.
- Uploads: size limit, MIME whitelist, generated file names (never trust the client's filename).
