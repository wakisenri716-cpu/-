-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "residentTaxSpecial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salaryPaidNextMonth" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "withholdingSpecial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "feeCategory" TEXT,
ADD COLUMN     "withholding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "withholdingBase" INTEGER;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "address" TEXT;

-- CreateTable
CREATE TABLE "TaxRemittance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxRemittance_companyId_kind_period_key" ON "TaxRemittance"("companyId", "kind", "period");

-- AddForeignKey
ALTER TABLE "TaxRemittance" ADD CONSTRAINT "TaxRemittance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

