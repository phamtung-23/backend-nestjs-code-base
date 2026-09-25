-- Append-only audit trail (see .claude/rules/cross-cutting.md)
-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "public"."audit_logs"("createdAt");
-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "public"."audit_logs"("actorId", "createdAt");
-- CreateIndex
CREATE INDEX "audit_logs_entityId_createdAt_idx" ON "public"."audit_logs"("entityId", "createdAt");
-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "public"."audit_logs"("action", "createdAt");
