-- CreateTable
CREATE TABLE "CashAdvice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvice_companyId_date_key" ON "CashAdvice"("companyId", "date");

-- AddForeignKey
ALTER TABLE "CashAdvice" ADD CONSTRAINT "CashAdvice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

