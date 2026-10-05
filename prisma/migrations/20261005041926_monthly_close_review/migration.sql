-- CreateTable
CREATE TABLE "MonthlyCloseReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "ready" BOOLEAN NOT NULL,
    "mode" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyCloseReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyCloseReview_companyId_month_key" ON "MonthlyCloseReview"("companyId", "month");

-- AddForeignKey
ALTER TABLE "MonthlyCloseReview" ADD CONSTRAINT "MonthlyCloseReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

