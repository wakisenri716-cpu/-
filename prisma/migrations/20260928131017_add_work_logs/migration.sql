-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "laborCostRate" INTEGER;

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "minutes" INTEGER NOT NULL,
    "task" TEXT,
    "hourlyCost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkLog_companyId_date_idx" ON "WorkLog"("companyId", "date");

-- CreateIndex
CREATE INDEX "WorkLog_userId_date_idx" ON "WorkLog"("userId", "date");

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

