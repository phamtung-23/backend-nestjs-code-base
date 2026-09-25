---
name: db-migration
description: Change the Prisma schema and create a safe, reviewed migration for this backend. Use whenever backend/prisma/schema.prisma must change — new model, field, relation, index or enum — or when the user asks for a migration.
argument-hint: <migration_name_in_snake_case>
---

# Database migration: $ARGUMENTS

All commands run from `backend/`. Follow `.claude/rules/database.md`.

## 1. Edit the schema

Change `prisma/schema.prisma`, then run:

```bash
npx prisma format && npx prisma validate
```

## 2. Generate the migration SQL

Name the folder `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` (UTC timestamp, snake_case name).

**A. Database available** (e.g. `docker compose up -d postgres` from the repo root, `DATABASE_URL` pointing at it):

```bash
yarn db:migrate:dev --create-only --name <name>
```

**B. No database** — diff the committed schema against the edited one (no DB connection needed):

```bash
git show HEAD:backend/prisma/schema.prisma > "$TMPDIR/schema.before.prisma"
mkdir -p prisma/migrations/<timestamp>_<name>
npx prisma migrate diff \
  --from-schema-datamodel "$TMPDIR/schema.before.prisma" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_<name>/migration.sql
```

## 3. Review the SQL before going further

- [ ] Only the intended changes; nothing unrelated from schema drift.
- [ ] No data loss: DROP COLUMN/TABLE, type narrowing and enum value removal need an expand → backfill → contract
      plan across releases. Stop and confirm with the user before any destructive step.
- [ ] `NOT NULL` columns added to populated tables have a default or a backfill step. No volatile default
      (`gen_random_uuid()`, `random()`) on `ADD COLUMN`: it rewrites the table under an exclusive lock that the
      rest of the file keeps holding (database rule, "Migrations").
- [ ] Indexes exist for new FKs and for filter/sort columns; no index duplicates a unique constraint. On large, busy
      tables, prefer `CREATE INDEX CONCURRENTLY` in its own migration (it can't run inside a transaction).
- [ ] Compatible with a rollback to the previous release, and with the still-running version wherever deploys
      overlap (several replicas, blue/green). This repo's single-replica `docker compose up -d` stops the old
      container before the new one migrates. Column drops/renames: `@ignore` first, delete the field a release later
      (database rule, "Migrations").

## 4. Apply and wire up

```bash
npx prisma generate
yarn db:migrate:dev   # when a local DB is available; otherwise it's applied on deploy
```

Update repositories, services, DTOs and tests, then run the `verify` skill and the `database-reviewer` agent.

## Never

- Edit or delete a committed migration (a PreToolUse hook blocks it) — create a new one.
- Run `prisma migrate reset`, `prisma db push` against shared databases, or any destructive command without explicit
  user approval.
