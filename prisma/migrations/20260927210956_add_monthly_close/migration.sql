-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "closeChecklist" JSONB;

-- CreateTable
CREATE TABLE "MonthlyCloseCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "checkedBy" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyCloseCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyCloseCheck_companyId_month_key_key" ON "MonthlyCloseCheck"("companyId", "month", "key");

-- AddForeignKey
ALTER TABLE "MonthlyCloseCheck" ADD CONSTRAINT "MonthlyCloseCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

