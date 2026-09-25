-- Indexes for the queries actually issued: latest code per (user, type), and
-- the cleanup job's expiresAt scans. otps.code was never queried.
-- DropIndex
DROP INDEX "public"."otps_userId_idx";
-- DropIndex
DROP INDEX "public"."otps_code_idx";
-- CreateIndex
CREATE INDEX "otps_userId_type_createdAt_idx" ON "public"."otps"("userId", "type", "createdAt");
-- CreateIndex
CREATE INDEX "otps_expiresAt_idx" ON "public"."otps"("expiresAt");
-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "public"."refresh_tokens"("expiresAt");
