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

- Model documented in `backend/documents/AUTHENTICATION.md`. Access token: JWT Bearer signed with `JWT_SECRET`.
  Refresh token: signed with `JWT_REFRESH_SECRET`, carries `type: 'refresh'` and a random `jti`, stored only as a
  SHA-256 hash, rotated atomically on every refresh (`TokenService`). `JwtStrategy` rejects refresh tokens. Keep all
  of that intact.
- Secure by default: `JwtAuthGuard` is a global `APP_GUARD`; open endpoints opt out with `@Public()` (from
  `modules/auth/decorators`). Protected endpoints add `@ApiBearerAuth('JWT-auth')` for Swagger. Never add
  `@UseGuards(JwtAuthGuard)` — it's already global.
- Read the current user with `@CurrentUser()` and client info (user agent, IP) with `@ClientMetaParam()`, never
  `@Request() req` / `@Req()`.
- Token lifetimes come from `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN`; don't hardcode new ones.
- `JwtStrategy` re-reads the user on every request and rejects missing or inactive accounts. Password change/reset
  revokes all of the user's refresh tokens (`TokenService.revokeAllForUser`), in the same transaction as the
  password write.
- Passwords: bcryptjs async API with cost ≥ 10. Select the `password` column only in credential-check queries;
  never log or return it.
- OTP: `OtpService` — `crypto.randomInt`, `OTP_EXPIRY_MINUTES`, single use, scoped by type, attempt limit via
  conditional updates. When a code is checked inside a transaction, return `false` from the callback instead of
  throwing: a rollback would undo the attempt counter.
- Public endpoints never reveal whether an account exists: same response either way, `AUTH_INVALID_CODE` for
  unknown emails, dummy bcrypt compare for unknown logins, and code-sending flows that do all their work (lookup,
  issuing, SMTP) after the response (`AuthService.runInBackground`), so timing reveals nothing. Deliberate
  exception: register answers 409 `AUTH_EMAIL_TAKEN`.
- Anything that sends a code is also limited per account (`OtpService.issue`: cooldown + hourly cap), not only per IP.
- Transactions that issue or revoke a user's sessions or codes start with `usersService.lockForUpdate(userId, tx)`;
  flows that verified a password outside the transaction re-check the hash under that lock.

## Authorization

- RBAC: `@Roles(UserRole.ADMIN)` (global `RolesGuard`, 403 `FORBIDDEN`). New admin endpoints default to ADMIN only.
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
- Raw SQL only through tagged `$queryRaw\`...\``; `$queryRawUnsafe` / `$executeRawUnsafe` with user input are
  forbidden.
- Uploads: size limit, MIME whitelist, generated file names (never trust the client's filename).
