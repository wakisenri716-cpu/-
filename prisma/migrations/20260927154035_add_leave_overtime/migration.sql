-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "overtimeMonthlyLimit" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "overtimeStartMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "overtimeYearlyLimit" INTEGER NOT NULL DEFAULT 360;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "hireDate" TIMESTAMP(3),
ADD COLUMN     "scheduledMinutes" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN     "weeklyDays" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "LeaveGrant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "grantDate" TIMESTAMP(3) NOT NULL,
    "halfDays" INTEGER NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveTaken" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "halfDays" INTEGER NOT NULL,
    "bulk" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveTaken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveGrant_companyId_idx" ON "LeaveGrant"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveGrant_staffId_grantDate_auto_key" ON "LeaveGrant"("staffId", "grantDate", "auto");

-- CreateIndex
CREATE INDEX "LeaveTaken_companyId_date_idx" ON "LeaveTaken"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveTaken_staffId_date_key" ON "LeaveTaken"("staffId", "date");

-- AddForeignKey
ALTER TABLE "LeaveGrant" ADD CONSTRAINT "LeaveGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveGrant" ADD CONSTRAINT "LeaveGrant_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveTaken" ADD CONSTRAINT "LeaveTaken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveTaken" ADD CONSTRAINT "LeaveTaken_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

