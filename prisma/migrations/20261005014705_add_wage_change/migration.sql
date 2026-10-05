-- CreateTable
CREATE TABLE "WageChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" INTEGER NOT NULL,
    "after" INTEGER NOT NULL,
    "previousStandard" INTEGER,
    "appliedStandard" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "appliedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WageChange_companyId_month_idx" ON "WageChange"("companyId", "month");

-- AddForeignKey
ALTER TABLE "WageChange" ADD CONSTRAINT "WageChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

