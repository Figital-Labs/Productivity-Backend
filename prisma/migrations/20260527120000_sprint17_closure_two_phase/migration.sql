-- Sprint 17: two-phase day closure (review → submit).
-- Adds `status` ('draft' | 'submitted') and `reviewedAt` to DayClosureSubmission.
-- Existing rows default to 'submitted', which is correct: any row that existed
-- before this migration was created by the pre-Sprint-17 single-shot submit
-- and is therefore a finalized closure.
ALTER TABLE "DayClosureSubmission"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN "reviewedAt" TIMESTAMP(3);
