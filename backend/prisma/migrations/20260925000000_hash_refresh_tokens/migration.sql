-- Expand step: refresh tokens are stored as SHA-256 hashes. The plaintext
-- column stays (nullable) so the previous release keeps running after a
-- rollback; a later migration drops it (contract step).

ALTER TABLE "public"."refresh_tokens" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "public"."refresh_tokens" ALTER COLUMN "token" DROP NOT NULL;

-- Keep live sessions: hash their tokens (same result as Node's
-- createHash('sha256')) and wipe the plaintext. Dead rows are removed.
DELETE FROM "public"."refresh_tokens" WHERE "isRevoked" OR "expiresAt" < NOW();
UPDATE "public"."refresh_tokens"
SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'),
    "token" = NULL;

CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "public"."refresh_tokens"("tokenHash");

-- The unique constraint already indexes the column
DROP INDEX "public"."refresh_tokens_token_idx";
