-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'FOREIGN';

-- CreateTable
CREATE TABLE "ForeignTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "jpyAmount" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledJpy" INTEGER,
    "settleJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForeignTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForeignTransaction_companyId_settledAt_idx" ON "ForeignTransaction"("companyId", "settledAt");

-- AddForeignKey
ALTER TABLE "ForeignTransaction" ADD CONSTRAINT "ForeignTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

