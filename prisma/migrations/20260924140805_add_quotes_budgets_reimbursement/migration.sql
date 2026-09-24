-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'INVOICED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'REIMBURSEMENT';

-- AlterTable
ALTER TABLE "ExpenseReport" ADD COLUMN     "reimbursedAt" TIMESTAMP(3),
ADD COLUMN     "reimbursementEntryId" TEXT;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "subtotalAmount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "unitPrice" INTEGER NOT NULL,
    "taxRate" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_invoiceId_key" ON "Quote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_companyId_quoteNumber_key" ON "Quote"("companyId", "quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_companyId_fiscalYear_accountId_key" ON "Budget"("companyId", "fiscalYear", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseReport_reimbursementEntryId_key" ON "ExpenseReport"("reimbursementEntryId");

-- AddForeignKey
ALTER TABLE "ExpenseReport" ADD CONSTRAINT "ExpenseReport_reimbursementEntryId_fkey" FOREIGN KEY ("reimbursementEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

