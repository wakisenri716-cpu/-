-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('PREPAID_EXPENSE', 'DEFERRED_REVENUE');

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'ALLOCATION';

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AllocationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "startMonth" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "projectId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "openingEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationPosting" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_openingEntryId_key" ON "Allocation"("openingEntryId");

-- CreateIndex
CREATE INDEX "Allocation_companyId_idx" ON "Allocation"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationPosting_journalEntryId_key" ON "AllocationPosting"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationPosting_allocationId_month_key" ON "AllocationPosting"("allocationId", "month");

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_openingEntryId_fkey" FOREIGN KEY ("openingEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationPosting" ADD CONSTRAINT "AllocationPosting_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationPosting" ADD CONSTRAINT "AllocationPosting_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

