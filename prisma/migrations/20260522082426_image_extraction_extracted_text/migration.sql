-- AlterTable
ALTER TABLE "ImageExtraction" ADD COLUMN     "extractedText" TEXT,
ALTER COLUMN "imageUrl" DROP NOT NULL;
