-- CreateTable
CREATE TABLE "MorningBriefCache" (
    "managerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MorningBriefCache_pkey" PRIMARY KEY ("managerId","date")
);

-- CreateIndex
CREATE INDEX "MorningBriefCache_managerId_generatedAt_idx" ON "MorningBriefCache"("managerId", "generatedAt");

-- AddForeignKey
ALTER TABLE "MorningBriefCache" ADD CONSTRAINT "MorningBriefCache_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
