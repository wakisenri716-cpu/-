-- CreateTable
CREATE TABLE "BonusRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BonusRun_journalEntryId_key" ON "BonusRun"("journalEntryId");

-- CreateIndex
CREATE INDEX "BonusRun_companyId_payDate_idx" ON "BonusRun"("companyId", "payDate");

-- AddForeignKey
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

