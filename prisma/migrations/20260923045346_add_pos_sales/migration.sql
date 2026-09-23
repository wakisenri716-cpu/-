-- CreateEnum
CREATE TYPE "PosProvider" AS ENUM ('SMAREGI', 'AIRREGI');

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'POS_SALE';

-- CreateTable
CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "PosProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "businessDate" TEXT NOT NULL,
    "storeName" TEXT,
    "totalAmount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "cashAmount" INTEGER NOT NULL,
    "cashlessAmount" INTEGER NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosSale_companyId_businessDate_idx" ON "PosSale"("companyId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_companyId_provider_externalId_key" ON "PosSale"("companyId", "provider", "externalId");

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
