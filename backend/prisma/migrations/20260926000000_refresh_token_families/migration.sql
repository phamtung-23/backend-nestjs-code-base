-- Refresh token families for reuse detection. The volatile default gives every
-- existing row (and rows inserted by the previous release after a rollback) a
-- family of its own, so no backfill is needed and rollback stays possible.
ALTER TABLE "public"."refresh_tokens" ADD COLUMN     "familyId" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- Existing revoked rows have no timestamp; treat them as revoked now
UPDATE "public"."refresh_tokens" SET "revokedAt" = NOW() WHERE "isRevoked";

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "public"."refresh_tokens"("familyId");
