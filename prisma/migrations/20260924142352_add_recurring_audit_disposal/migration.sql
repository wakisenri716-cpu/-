-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceType" ADD VALUE 'RECURRING';
ALTER TYPE "SourceType" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "disposalEntryId" TEXT,
ADD COLUMN     "disposalPrice" INTEGER,
ADD COLUMN     "disposedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RecurringEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringLine" (
    "id" TEXT NOT NULL,
    "recurringEntryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" INTEGER NOT NULL,
    "credit" INTEGER NOT NULL,

    CONSTRAINT "RecurringLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPosting" (
    "id" TEXT NOT NULL,
    "recurringEntryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPosting_journalEntryId_key" ON "RecurringPosting"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPosting_recurringEntryId_month_key" ON "RecurringPosting"("recurringEntryId", "month");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_disposalEntryId_key" ON "FixedAsset"("disposalEntryId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_disposalEntryId_fkey" FOREIGN KEY ("disposalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntry" ADD CONSTRAINT "RecurringEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringLine" ADD CONSTRAINT "RecurringLine_recurringEntryId_fkey" FOREIGN KEY ("recurringEntryId") REFERENCES "RecurringEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringLine" ADD CONSTRAINT "RecurringLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPosting" ADD CONSTRAINT "RecurringPosting_recurringEntryId_fkey" FOREIGN KEY ("recurringEntryId") REFERENCES "RecurringEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPosting" ADD CONSTRAINT "RecurringPosting_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

