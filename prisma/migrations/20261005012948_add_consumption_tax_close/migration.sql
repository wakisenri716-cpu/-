-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'CONSUMPTION_TAX';

-- CreateTable
CREATE TABLE "ConsumptionTaxClose" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "postedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionTaxClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionTaxClose_companyId_fiscalYear_key" ON "ConsumptionTaxClose"("companyId", "fiscalYear");

-- AddForeignKey
ALTER TABLE "ConsumptionTaxClose" ADD CONSTRAINT "ConsumptionTaxClose_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

