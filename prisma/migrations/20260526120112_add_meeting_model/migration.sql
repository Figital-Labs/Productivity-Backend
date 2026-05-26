-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "attendeeIds" TEXT[],
    "agenda" TEXT,
    "notes" TEXT,
    "summary" TEXT,
    "customPrompt" TEXT,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_userId_deletedAt_idx" ON "Meeting"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Meeting_userId_scheduledAt_idx" ON "Meeting"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Meeting_userId_processedAt_idx" ON "Meeting"("userId", "processedAt");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
