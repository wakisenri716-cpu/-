-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'CASH_COUNT';

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "counts" JSONB NOT NULL,
    "counted" INTEGER NOT NULL,
    "book" INTEGER NOT NULL,
    "diff" INTEGER NOT NULL,
    "note" TEXT,
    "countedByName" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashCount_companyId_date_idx" ON "CashCount"("companyId", "date");

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

