-- Contract step of 20260925000000_hash_refresh_tokens (2/2). A separate file:
-- Prisma runs each file as one transaction, and the previous one's exclusive
-- lock would otherwise be held through the validation scan below.

-- Must come first: it scans the table under SHARE UPDATE EXCLUSIVE (reads and
-- writes go on); the statements after it take ACCESS EXCLUSIVE, briefly
ALTER TABLE "public"."refresh_tokens" VALIDATE CONSTRAINT "refresh_tokens_tokenHash_not_null";

-- The validated check proves it, so PostgreSQL skips a second scan
ALTER TABLE "public"."refresh_tokens" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE "public"."refresh_tokens" DROP CONSTRAINT "refresh_tokens_tokenHash_not_null";

-- The plaintext column, unused since that release; its unique index goes with it.
-- Releases before this one still select it (Prisma reads every column of the
-- rows it returns without an explicit select): deploy by stopping the old
-- container first, as this repo's single-replica Compose deploy does, and
-- don't roll back past this migration.
ALTER TABLE "public"."refresh_tokens" DROP COLUMN "token";
