-- Contract step of 20260925000000_hash_refresh_tokens (1/2). No deployment
-- rolls back past that release anymore, so a row without a hash can only be
-- a session the previous release wrote: dead, since tokens are found by hash.
-- No lock_timeout: deploys stop the old container first, so waiting for a lock
-- stalls no traffic, while a timeout would leave a failed migration (P3009).

DELETE FROM "public"."refresh_tokens" WHERE "tokenHash" IS NULL;

-- NOT VALID only checks new rows, so adding it takes the exclusive lock for an
-- instant instead of for a table scan. The next migration validates it
-- without blocking reads or writes, then turns it into NOT NULL.
ALTER TABLE "public"."refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_tokenHash_not_null" CHECK ("tokenHash" IS NOT NULL) NOT VALID;
