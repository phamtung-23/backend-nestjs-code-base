---
name: new-resource
description: Scaffold a complete REST resource module in this NestJS backend — Prisma model + migration, repository, service, controller, DTOs, list query (pagination, filter, sort, search, fields, include), ownership/roles, optimistic locking, Swagger and unit tests — following the repo's API standards. Use when the user asks to add a new resource, entity, CRUD API or module.
argument-hint: <resource-name> [field:type ...]
---

# New resource: $ARGUMENTS

Build a new resource module that satisfies every rule in `.claude/rules/` on the first pass. The reference
implementation is `reference/templates.md` (a working `articles` module); shared building blocks are in
`reference/foundations.md`.

## 1. Clarify the model (ask only what you can't infer)

- Resource name (plural kebab-case for the path/module, singular PascalCase for the model).
- Fields with types, required/optional, max lengths, enums; which are filterable, sortable, searchable.
- Relations and which may be embedded via `?include=`.
- Access: owned by a user (ownership checks) or role-based (`@Roles`), and which operations are public.
- Concurrent edits possible? → `version` column + optimistic locking (default: yes for user-edited resources).
- Offset pagination (default) or cursor pagination (feeds, very large tables).

## 2. Foundations

Read CLAUDE.md "Foundations status". The templates need: error codes, transform helpers, the list query contract
(`src/common/query`), `ApiEnvelopeResponse`, and `@CurrentUser()`. Build any missing piece first from
`reference/foundations.md`, with its tests, and update the status table. Tell the user which foundations you added.

## 3. Schema + migration

Add the model following `.claude/rules/database.md` (cuid id, timestamps, `onDelete`, `version` if needed, an index
for every FK/filter/sort column, `@@map` to a snake_case plural table). Then follow the `db-migration` skill to create
and review the migration.

## 4. Module files

Create `backend/src/modules/<name>/` by adapting `reference/templates.md`:

- `<name>.constants.ts` — SORTABLE, DEFAULT_SORT, SEARCHABLE, FIELDS (non-sensitive only), INCLUDABLE, error codes
- `dto/` — create, update (`PartialType` + `version`), list query (extends `ListQueryDto`), response DTO
- `<name>.repository.ts` — Prisma only, optional `tx` on every method, `findPage` via `$transaction([findMany, count])`
- `<name>.service.ts` — filters → `where`, `parseSort` / `buildSelect` / `buildSearch`, explicit field mapping,
  ownership → 404, stale version → 409 `VERSION_CONFLICT`, transactions for multi-writes, side effects after commit
- `<name>.controller.ts` — thin; correct status codes (201 create, 204 delete, `@HttpCode(200)` for actions);
  `ResponseHelper`; full Swagger decorators; `@RateLimit` for expensive or sensitive routes
- `<name>.module.ts` — controller + service + repository, export the service; register it in `AppModule`

Write an audit entry (`auditService.log(entry, tx)`; module actions as `<Module>AuditAction` in `<name>.constants.ts`)
inside the transaction of every create/update/delete, and put `@Idempotent()` on create and side-effect endpoints.

## 5. Tests

`<name>.service.spec.ts` in the style of the template: every branch, including invalid sort/fields/include (400
`INVALID_QUERY_PARAM`), not found / not owner (404), stale version (409), and exact repository arguments. Use the
`test-writer` agent if the surface is large.

Add `backend/test/<name>.e2e-spec.ts`: happy paths, ownership/roles (404/403), validation (400), list query params
(pagination meta, invalid sort → 400), optimistic locking (409).

## 6. Verify and review

1. Run the `verify` skill (lint, format, build, tests + coverage).
2. Run the `api-standards-reviewer` and `database-reviewer` agents on the new module (in parallel) and fix what they
   report.
3. Summarize for the user: endpoints (method, path, status codes), query params supported, files created, the
   migration name, and any foundations added.
