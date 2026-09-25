# Authentication

How the auth module behaves. The Swagger UI (`/docs`) has the exact request and response schemas; this page explains
the model behind them.

## Endpoints (`/v1/auth/...`)

| Method & path | Auth | Success | Notes |
| --- | --- | --- | --- |
| `POST register` | public | 201 user | 409 `AUTH_EMAIL_TAKEN`; emails a verification code |
| `POST login` | public | 200 session | 401 `AUTH_INVALID_CREDENTIALS`; 403 `AUTH_EMAIL_NOT_VERIFIED`, `AUTH_ACCOUNT_DISABLED` |
| `POST verify-email` | public | 200 | needs the password too: 401 `AUTH_INVALID_CREDENTIALS`, 422 `AUTH_INVALID_CODE` |
| `POST resend-verification` | public | 200 | same answer whether or not the account exists |
| `POST forgot-password` | public | 200 | same answer whether or not the account exists |
| `POST reset-password` | public | 200 | 422 `AUTH_INVALID_CODE`; signs the account out everywhere |
| `POST send-otp` | public | 200 | emails a one-time login code; same answer for unknown emails |
| `POST verify-otp` | public | 200 session | 422 `AUTH_INVALID_CODE`; logs in with the code (works before verification) |
| `POST refresh-token` | public | 200 tokens | 401 `AUTH_INVALID_REFRESH_TOKEN` |
| `POST logout` | public | 200 | ends the session the refresh token belongs to; idempotent |
| `GET profile` | bearer | 200 user | |
| `POST change-password` | bearer | 200 tokens | 422 `AUTH_CURRENT_PASSWORD_INCORRECT`; other sessions end |
| `POST logout-all` | bearer | 200 | revokes every refresh token of the user |

A **session** is `{ accessToken, refreshToken, user }`, and **tokens** are `{ accessToken, refreshToken }`. Everything
is wrapped in the standard envelope (`src/common/README.md`). Every route with a body can also answer 400
`VALIDATION_FAILED`, and rate-limited routes 429 `RATE_LIMITED`.

## Access control

- Every route requires a valid access token unless it's marked `@Public()`: `JwtAuthGuard` is a global guard.
- `@Roles(UserRole.ADMIN)` limits a route to roles (`RolesGuard`, 403 `FORBIDDEN`).
- `@CurrentUser()` injects the authenticated user without the password hash.
- Every request re-reads the user: deleted or disabled (`isActive = false`) accounts lose access immediately.

## Tokens

| | Access token | Refresh token |
| --- | --- | --- |
| Signed with | `JWT_SECRET` | `JWT_REFRESH_SECRET` (must differ) |
| Lifetime | `JWT_ACCESS_EXPIRES_IN` (default `15m`) | `JWT_REFRESH_EXPIRES_IN` (default `7d`) |
| Payload | `sub`, `email`, `role` | `sub`, `type: 'refresh'`, random `jti` |
| Stored | no | SHA-256 hash in `refresh_tokens`, with user agent and IP |
| Accepted by | `JwtAuthGuard` | `POST refresh-token` / `logout` only |

- **Sessions (families):** each login starts a token family; rotation keeps the family. Logout revokes the whole
  family, i.e. the session on that device.
- **Rotation:** every refresh revokes the presented token and returns a new pair. A token can be used once. If two
  requests race with the same token, one wins and the other gets 401.
- **Reuse detection:** presenting an already-rotated token more than 30 seconds after its rotation means it was
  copied. The whole family is revoked, so whoever holds its newest token is signed out as well, and a warning is
  logged. Within 30 seconds it's treated as two tabs refreshing at once and just gets 401.
- **Revocation:** logout revokes one token. Logout-all, a password change and a password reset revoke all of them. A
  password change returns a new pair so the current session continues.
- **Concurrency:** every transaction that issues or revokes a user's sessions or codes first locks the user row
  (`SELECT ... FOR UPDATE`), so a reset can't miss a token issued at the same moment, and login re-checks the password
  hash under that lock.
- **Cleanup:** an hourly job (`AuthCleanupTask`) deletes expired tokens, revoked tokens older than 30 days, expired
  codes and used codes older than a day, in batches.

## One-time codes

- 6 digits from `crypto.randomInt`, valid for `OTP_EXPIRY_MINUTES` (default 10), single use, scoped by type
  (`VERIFICATION`, `PASSWORD_RESET`, `LOGIN`). Issuing a code invalidates older codes of the same type.
- Per account and type: at most 5 codes per hour and one per minute. Requests beyond that get the usual generic answer
  but no email. Combined with the attempt limit this caps guesses at about 25 per hour per account, however many IPs
  an attacker uses.
- Every check counts as an attempt. After `OTP_MAX_ATTEMPTS` (default 5) the code is dead, even if the next guess is
  right, and the user must request a new one. Counting uses conditional updates, so parallel guesses can't exceed
  the limit.
- The endpoints that accept codes are rate limited to 5 requests per minute per IP.

## Account enumeration

- Public endpoints that send email answer the same way whether or not the account exists, and do all their work
  (account lookup, issuing the code, SMTP) after responding, so their response time is the same either way.
- Endpoints that take a code return `AUTH_INVALID_CODE` both for a wrong code and for an unknown email.
- Login compares unknown emails against a dummy bcrypt hash, so both cases take equally long.
- Registration reveals that an email is taken (409) — a deliberate trade-off for a clear sign-up UX; it's rate
  limited.
- Email delivery failures are logged, not returned. Users can request a new code.

## Email verification

- Password login requires a verified email (403 `AUTH_EMAIL_NOT_VERIFIED`, checked only after the password matched).
- `verify-email` needs the code **and the account password**: only the person who registered can verify. Wrong
  passwords and unknown emails get the same 401 as login, and don't use up the code's attempts.
- A successful password reset also verifies the email: the code reached that mailbox.
- Login by code (`send-otp` / `verify-otp`) works before verification but doesn't verify the email.
- Together this stops someone from registering another person's email first. They can't verify it (the code goes
  to the owner), and the owner can't accidentally verify it for them (they don't know the password), so the
  squatter's password never works. The owner takes the account over with a password reset.

## Known gaps (accepted)

- OTP codes are stored in plain text for their short lifetime (an HMAC with a server secret would change that).
- Sessions are sliding: each refresh extends the family by `JWT_REFRESH_EXPIRES_IN`; there's no absolute cap.
- Access tokens stay valid until they expire (default 15 minutes) after a logout or password reset.

## Client integration

1. Store the refresh token somewhere durable and private to your app; keep the access token in memory.
2. Send `Authorization: Bearer <accessToken>` on API calls.
3. On a 401 from a protected route, call `POST /v1/auth/refresh-token` once, replace **both** tokens, and retry. If
   the refresh fails too, send the user to the login screen.
4. Serialize refreshes: two tabs refreshing with the same token at once means one of them gets logged out.
