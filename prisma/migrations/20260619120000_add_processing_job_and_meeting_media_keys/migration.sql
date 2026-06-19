-- Catch-up migration: the async pipeline added `ProcessingJob` to the schema (pg-boss job
-- status store) and this change adds `Meeting.mediaKeys` (durable S3 audit trail), but neither
-- had a migration on this branch — so a fresh `migrate deploy` was missing both. This creates
-- them. Body generated via `prisma migrate diff`; made IDEMPOTENT (IF NOT EXISTS) so it also
-- applies cleanly on a dev DB that already has `ProcessingJob` from an earlier `prisma db push`.

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProcessingJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "mediaKeys" TEXT[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProcessingJob_userId_kind_status_idx" ON "ProcessingJob"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProcessingJob_targetType_targetId_status_idx" ON "ProcessingJob"("targetType", "targetId", "status");
