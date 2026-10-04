-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'CORPORATE_TAX';

-- CreateTable
CREATE TABLE "CorporateTaxRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "journalEntryId" TEXT,
    "postedByName" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateTaxRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorporateTaxRun_companyId_fiscalYear_key" ON "CorporateTaxRun"("companyId", "fiscalYear");

-- AddForeignKey
ALTER TABLE "CorporateTaxRun" ADD CONSTRAINT "CorporateTaxRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

