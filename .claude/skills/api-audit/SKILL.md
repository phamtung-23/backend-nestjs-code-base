---
name: api-audit
description: Full audit of this backend against its API standards (naming, HTTP semantics, versioning, envelope, errors, validation, pagination/filter/sort/search, fields/include and N+1, auth, rate limit, CORS, audit log, transactions, idempotency, concurrency, performance, SOLID), then update the Foundations status in CLAUDE.md.
disable-model-invocation: true
---

# API standards audit

## 1. Collect evidence in parallel

Launch these at once, each with a full-repository scope rather than just the diff:

- `api-standards-reviewer` — all of `backend/src`
- `security-reviewer` — `backend/src`, `backend/prisma`, `docker-compose*.yml`, `traefik/`, `.github/workflows/`,
  `.env.sample`
- `database-reviewer` — `backend/prisma`, every repository and service
- the `verify` skill yourself, for the quality gate

## 2. Score every criterion

Use ✅ meets the standard / ⚠️ partial / ❌ missing, and cite `file:line` evidence for each:

| # | Criterion | Rule |
| --- | --- | --- |
| 1 | Naming & resources | api-design |
| 2 | HTTP methods & status codes | api-design, errors |
| 3 | Versioning | api-design |
| 4 | Response envelope consistency | api-design |
| 5 | Error format & codes | errors |
| 6 | Validation | validation |
| 7 | Pagination | api-design, database |
| 8 | Filter / sort / search | api-design |
| 9 | Sparse fieldsets | api-design |
| 10 | Include / expand, N+1 | api-design, database |
| 11 | Authentication & authorization | security |
| 12 | Rate limiting | security |
| 13 | CORS & security headers | security |
| 14 | Audit log | cross-cutting |
| 15 | Transactions | database |
| 16 | Idempotency | cross-cutting |
| 17 | Concurrency | database |
| 18 | Performance (indexes, select, caching) | database |
| 19 | SOLID & layering | architecture |
| 20 | Tests & quality gate | testing |

## 3. Output and follow-up

1. Report to the user (in Vietnamese): the scored table, then the top findings ordered by severity, then a
   recommended fix order grouped into small, independently shippable steps.
2. Update CLAUDE.md "Foundations status" and "Known deviations" so they match reality. Don't change anything else
   without asking.
