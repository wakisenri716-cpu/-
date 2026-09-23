-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('PENDING', 'POSTED', 'MATCHED', 'IGNORED');

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'BANK';

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "withdrawal" INTEGER NOT NULL DEFAULT 0,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "suggestedAccountCode" TEXT,
    "confidence" DOUBLE PRECISION,
    "suggestionSource" TEXT,
    "suggestionReason" TEXT,
    "matchedInvoiceId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_journalEntryId_key" ON "BankTransaction"("journalEntryId");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_status_date_idx" ON "BankTransaction"("companyId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_companyId_fingerprint_key" ON "BankTransaction"("companyId", "fingerprint");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedInvoiceId_fkey" FOREIGN KEY ("matchedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
