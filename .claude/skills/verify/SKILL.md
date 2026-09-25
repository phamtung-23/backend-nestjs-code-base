---
name: verify
description: Run this backend's quality gate — ESLint, Prettier check, TypeScript build, Jest unit tests with coverage — and report real results. Use before saying any code task is done, before committing or pushing, and whenever the user asks to check, verify or test the code.
---

# Verify

Run from `backend/`, in order. A failing build blocks the tests; the other steps always run so you can report
everything at once.

1. `yarn lint:check`
2. `yarn format:check` — if it fails, run `yarn format`, re-run the check, and list the files it changed.
3. `yarn build`
4. `yarn test:cov` — all suites pass and the 95% global coverage threshold holds.
5. `yarn test:e2e` when HTTP behavior, auth, persistence or wiring changed (needs Docker; starts Postgres/Redis
   containers). If Docker isn't available, say so instead of skipping silently.

Extra checks when relevant:

- `prisma/schema.prisma` differs from `HEAD` → `npx prisma validate`, and confirm a new folder exists under
  `prisma/migrations/`.
- A `docker-compose*.yml` file changed → `docker compose -f docker-compose.yml -f <file> config --quiet` from the
  repo root (with `--env-file .env.sample` when `.env` is absent).
- A new env var appeared → it exists in `.env.sample`, `backend/.env.example` and every compose backend
  `environment` block.

## Report

| Step | Result | Notes |
| --- | --- | --- |
| lint | ✅ / ❌ | error count, first errors |
| format | ✅ / ❌ | files reformatted |
| build | ✅ / ❌ | first compiler errors |
| tests | ✅ / ❌ | passed/total, coverage %, failing test names |
| e2e | ✅ / ❌ / not run | passed/total, or why it wasn't run |

Quote the relevant failure output. Never mark a step ✅ that you didn't run or that failed.
