-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ADVISOR';

-- CreateTable
CREATE TABLE "JournalComment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalComment_companyId_resolvedAt_idx" ON "JournalComment"("companyId", "resolvedAt");

-- CreateIndex
CREATE INDEX "JournalComment_journalEntryId_idx" ON "JournalComment"("journalEntryId");

-- AddForeignKey
ALTER TABLE "JournalComment" ADD CONSTRAINT "JournalComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalComment" ADD CONSTRAINT "JournalComment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

