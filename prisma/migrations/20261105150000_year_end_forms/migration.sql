-- CreateTable
CREATE TABLE "YearEndSubmission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reply" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YearEndSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YearEndSubmission_companyId_year_status_idx" ON "YearEndSubmission"("companyId", "year", "status");

-- CreateIndex
CREATE UNIQUE INDEX "YearEndSubmission_staffId_year_key" ON "YearEndSubmission"("staffId", "year");

-- AddForeignKey
ALTER TABLE "YearEndSubmission" ADD CONSTRAINT "YearEndSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

