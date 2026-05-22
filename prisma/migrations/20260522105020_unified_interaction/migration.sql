-- CreateTable
CREATE TABLE "UnifiedInteraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputText" TEXT,
    "audioUrl" TEXT,
    "imageUrl" TEXT,
    "actions" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnifiedInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnifiedInteraction_userId_createdAt_idx" ON "UnifiedInteraction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UnifiedInteraction" ADD CONSTRAINT "UnifiedInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
