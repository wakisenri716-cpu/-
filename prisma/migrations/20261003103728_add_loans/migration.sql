-- CreateEnum
CREATE TYPE "LoanMethod" AS ENUM ('EQUAL_PAYMENT', 'EQUAL_PRINCIPAL');

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'LOAN';

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "principal" INTEGER NOT NULL,
    "annualRate" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "method" "LoanMethod" NOT NULL,
    "borrowedAt" TIMESTAMP(3) NOT NULL,
    "firstPaymentMonth" TEXT NOT NULL,
    "paymentDay" INTEGER NOT NULL,
    "bankCode" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "openingEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "principal" INTEGER NOT NULL,
    "interest" INTEGER NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Loan_openingEntryId_key" ON "Loan"("openingEntryId");

-- CreateIndex
CREATE INDEX "Loan_companyId_idx" ON "Loan"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_journalEntryId_key" ON "LoanPayment"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_loanId_month_key" ON "LoanPayment"("loanId", "month");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_openingEntryId_fkey" FOREIGN KEY ("openingEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

