---
paths:
  - "backend/src/**/*.spec.ts"
  - "backend/test/**"
  - "backend/package.json"
---

# Testing

- Unit tests sit next to the file (`users.service.spec.ts`). Instantiate the class directly with hand-written jest
  mocks, as `auth.service.spec.ts` does; use `Test.createTestingModule` only to test DI wiring.
- Cover every branch of service logic: happy path, every thrown error (assert the exception class **and** the
  `errorCode`), limits, and concurrency outcomes (`count: 0` from a conditional update).
- Assert behavior: exact Prisma `where` / `data` arguments, returned shapes, absence of sensitive fields. Don't
  assert incidental implementation details.
- Coverage gate is 95% global (`yarn test:cov`). When a new kind of file gains logic (guards, interceptors,
  filters, repositories), add it to `collectCoverageFrom` in `backend/package.json`.
- Controllers, guards, filters and interceptors with logic get unit tests too.
- e2e: `backend/test/*.e2e-spec.ts`, run with `yarn test:e2e` (Docker required). `globalSetup` starts Postgres and
  Redis with testcontainers and applies the migrations; each file builds the real app with `createTestApp()`
  (`test/utils/test-app.ts`: production wiring via `setupApp`, `MailService` replaced by `FakeMailbox`). Use
  `t.http()` — every call gets its own client IP so rate limits don't interfere; the counter restarts in each file,
  so `createTestApp()` flushes Redis — `t.mailbox.code(email, kind)` for emailed codes, and `uniqueEmail()`; tests
  share the database, so never rely on it being empty.
- Every new or changed endpoint gets e2e coverage of its happy path, auth/roles, validation and main errors.
- Tests never hit real SMTP or the network — mock nodemailer and other adapters.
- Test names describe behavior: `it('returns 409 when the email already exists')`.
