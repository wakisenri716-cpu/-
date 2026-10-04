-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'DEPT_ALLOCATION';

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountCodes" TEXT[],
    "basis" TEXT NOT NULL DEFAULT 'FIXED',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocationRun" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "journalEntryIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostAllocationRun_allocationId_month_key" ON "CostAllocationRun"("allocationId", "month");

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocationRun" ADD CONSTRAINT "CostAllocationRun_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "CostAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

