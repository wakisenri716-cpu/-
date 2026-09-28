-- CreateTable
CREATE TABLE "YearEndAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YearEndAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YearEndAdjustment_companyId_year_idx" ON "YearEndAdjustment"("companyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "YearEndAdjustment_staffId_year_key" ON "YearEndAdjustment"("staffId", "year");

-- AddForeignKey
ALTER TABLE "YearEndAdjustment" ADD CONSTRAINT "YearEndAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YearEndAdjustment" ADD CONSTRAINT "YearEndAdjustment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

