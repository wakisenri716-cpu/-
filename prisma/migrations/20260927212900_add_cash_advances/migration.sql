-- CreateEnum
CREATE TYPE "CashAdvanceStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CashAdvance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "payFrom" TEXT NOT NULL,
    "status" "CashAdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "issueEntryId" TEXT NOT NULL,
    "expenseReportId" TEXT,
    "settleEntryId" TEXT,
    "settledDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_issueEntryId_key" ON "CashAdvance"("issueEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_expenseReportId_key" ON "CashAdvance"("expenseReportId");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvance_settleEntryId_key" ON "CashAdvance"("settleEntryId");

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_issueEntryId_fkey" FOREIGN KEY ("issueEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_expenseReportId_fkey" FOREIGN KEY ("expenseReportId") REFERENCES "ExpenseReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_settleEntryId_fkey" FOREIGN KEY ("settleEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

