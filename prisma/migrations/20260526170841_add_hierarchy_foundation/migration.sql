-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ward',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("userId","groupId","validFrom")
);

-- CreateTable
CREATE TABLE "SubmissionReview" (
    "submissionId" TEXT NOT NULL,
    "submissionKind" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionReview_pkey" PRIMARY KEY ("submissionId","submissionKind","reviewerId")
);

-- CreateTable
CREATE TABLE "ReminderIntent" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT NOT NULL,

    CONSTRAINT "ReminderIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Department_orgId_idx" ON "Department"("orgId");

-- CreateIndex
CREATE INDEX "ContextGroup_orgId_idx" ON "ContextGroup"("orgId");

-- CreateIndex
CREATE INDEX "ContextGroup_departmentId_idx" ON "ContextGroup"("departmentId");

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_validTo_idx" ON "GroupMembership"("groupId", "validTo");

-- CreateIndex
CREATE INDEX "GroupMembership_userId_validTo_idx" ON "GroupMembership"("userId", "validTo");

-- CreateIndex
CREATE INDEX "SubmissionReview_reviewerId_reviewedAt_idx" ON "SubmissionReview"("reviewerId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ReminderIntent_targetUserId_sentAt_idx" ON "ReminderIntent"("targetUserId", "sentAt");

-- CreateIndex
CREATE INDEX "Task_groupId_targetDate_idx" ON "Task"("groupId", "targetDate");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ContextGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headId_fkey" FOREIGN KEY ("headId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextGroup" ADD CONSTRAINT "ContextGroup_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ContextGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionReview" ADD CONSTRAINT "SubmissionReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderIntent" ADD CONSTRAINT "ReminderIntent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderIntent" ADD CONSTRAINT "ReminderIntent_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
