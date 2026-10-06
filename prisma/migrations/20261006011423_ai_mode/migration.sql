-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "aiKeyEnc" TEXT,
ADD COLUMN     "aiKeyHint" TEXT,
ADD COLUMN     "aiKeySetAt" TIMESTAMP(3),
ADD COLUMN     "aiMode" TEXT NOT NULL DEFAULT 'INCLUDED';

