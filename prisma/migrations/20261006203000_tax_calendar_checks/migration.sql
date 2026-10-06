-- CreateTable
CREATE TABLE "TaxCalendarCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCalendarCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxCalendarCheck_companyId_key_key" ON "TaxCalendarCheck"("companyId", "key");

-- AddForeignKey
ALTER TABLE "TaxCalendarCheck" ADD CONSTRAINT "TaxCalendarCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

