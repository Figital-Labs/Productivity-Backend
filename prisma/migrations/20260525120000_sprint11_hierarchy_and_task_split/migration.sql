-- Sprint 11: Split Task.userId into assigneeId + creatorId, and add a
-- many-to-many self-relation on User for the hospital staff hierarchy.
--
-- The 53 existing task rows are backfilled so that assigneeId = creatorId =
-- old userId (every pre-existing task was self-created). Then the old
-- userId column is dropped.

-- 1. Drop the existing foreign key + indexes on Task.userId
ALTER TABLE "Task" DROP CONSTRAINT "Task_userId_fkey";
DROP INDEX "Task_userId_targetDate_idx";
DROP INDEX "Task_userId_deletedAt_idx";

-- 2. Add the new columns as nullable so we can backfill before NOT NULL
ALTER TABLE "Task" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "Task" ADD COLUMN "creatorId" TEXT;

-- 3. Backfill: every pre-existing task was its own assignee and creator
UPDATE "Task" SET "assigneeId" = "userId", "creatorId" = "userId";

-- 4. Now safe to make them NOT NULL
ALTER TABLE "Task" ALTER COLUMN "assigneeId" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "creatorId" SET NOT NULL;

-- 5. Drop the old column
ALTER TABLE "Task" DROP COLUMN "userId";

-- 6. Add foreign keys to the new columns
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Create the new indexes (one per query path; assigneeId-leading is
-- correct because tasks appear on the assignee's day plan)
CREATE INDEX "Task_assigneeId_targetDate_idx" ON "Task"("assigneeId", "targetDate");
CREATE INDEX "Task_assigneeId_deletedAt_idx" ON "Task"("assigneeId", "deletedAt");

-- 8. Create the M2M self-relation join table for the User hierarchy.
-- Prisma's implicit M2M convention: table _UserHierarchy with columns A, B.
-- The "reports" field comes first in the User model, so it maps to A
-- (manager id) and "managers" maps to B (subordinate id) — i.e. row (A,B)
-- means "A manages B".
CREATE TABLE "_UserHierarchy" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_UserHierarchy_AB_pkey" PRIMARY KEY ("A", "B")
);

CREATE INDEX "_UserHierarchy_B_index" ON "_UserHierarchy"("B");

ALTER TABLE "_UserHierarchy" ADD CONSTRAINT "_UserHierarchy_A_fkey"
  FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_UserHierarchy" ADD CONSTRAINT "_UserHierarchy_B_fkey"
  FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
