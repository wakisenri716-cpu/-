-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "consumptionTaxMethod" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "expenseApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "simplifiedBusinessType" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "ExpenseReport" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "returnComment" TEXT;

-- CreateTable
CREATE TABLE "JournalTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalTemplate_companyId_name_key" ON "JournalTemplate"("companyId", "name");

-- AddForeignKey
ALTER TABLE "JournalTemplate" ADD CONSTRAINT "JournalTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

