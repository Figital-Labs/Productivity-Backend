-- CreateTable
CREATE TABLE "TextInteraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputText" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TextInteraction_userId_createdAt_idx" ON "TextInteraction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TextInteraction" ADD CONSTRAINT "TextInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
