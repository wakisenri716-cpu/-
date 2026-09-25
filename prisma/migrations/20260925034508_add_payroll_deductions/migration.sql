-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "payrollCareRate" INTEGER NOT NULL DEFAULT 1590,
ADD COLUMN     "payrollEmploymentRate" INTEGER NOT NULL DEFAULT 550,
ADD COLUMN     "payrollHealthRate" INTEGER NOT NULL DEFAULT 9910,
ADD COLUMN     "payrollPensionRate" INTEGER NOT NULL DEFAULT 18300,
ADD COLUMN     "payrollPrefecture" TEXT NOT NULL DEFAULT '東京都';

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "details" JSONB;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "careInsurance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commuteAllowance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dependents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "employmentInsurance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "residentTax" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "socialInsurance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "standardMonthly" INTEGER,
ADD COLUMN     "taxColumn" TEXT NOT NULL DEFAULT 'KOU';

-- CreateTable
CREATE TABLE "PayrollOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "incomeTax" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollOverride_companyId_month_idx" ON "PayrollOverride"("companyId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollOverride_staffId_month_key" ON "PayrollOverride"("staffId", "month");

