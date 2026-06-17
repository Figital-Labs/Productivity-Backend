-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "scheduledDurationMinutes" INTEGER,
ADD COLUMN     "scheduledStartMinute" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "workEndMinute" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN     "workStartMinute" INTEGER NOT NULL DEFAULT 540;

-- CreateIndex
CREATE INDEX "Task_assigneeId_targetDate_scheduledStartMinute_idx" ON "Task"("assigneeId", "targetDate", "scheduledStartMinute");
