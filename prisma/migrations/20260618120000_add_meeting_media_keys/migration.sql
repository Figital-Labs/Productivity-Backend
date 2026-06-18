-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
