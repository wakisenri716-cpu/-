-- CreateTable
CREATE TABLE "BankRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "minAmount" INTEGER,
    "maxAmount" INTEGER,
    "bankAccountId" TEXT,
    "accountCode" TEXT NOT NULL,
    "autoPost" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankRule_companyId_sortOrder_idx" ON "BankRule"("companyId", "sortOrder");

-- AddForeignKey
ALTER TABLE "BankRule" ADD CONSTRAINT "BankRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRule" ADD CONSTRAINT "BankRule_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

