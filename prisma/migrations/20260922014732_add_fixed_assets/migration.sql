-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'FIXED_ASSET';

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" INTEGER NOT NULL,
    "residualValue" INTEGER NOT NULL DEFAULT 1,
    "usefulLifeYears" INTEGER NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationEntry" (
    "id" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_journalEntryId_key" ON "FixedAsset"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationEntry_journalEntryId_key" ON "DepreciationEntry"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationEntry_fixedAssetId_period_key" ON "DepreciationEntry"("fixedAssetId", "period");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationEntry" ADD CONSTRAINT "DepreciationEntry_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "FixedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationEntry" ADD CONSTRAINT "DepreciationEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
