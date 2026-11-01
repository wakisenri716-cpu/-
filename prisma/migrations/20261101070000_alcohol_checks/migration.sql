-- CreateTable
CREATE TABLE "AlcoholCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "driverId" TEXT,
    "driverName" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "bookingId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'FACE',
    "detected" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "checkerName" TEXT NOT NULL,
    "note" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlcoholCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlcoholCheck_companyId_date_idx" ON "AlcoholCheck"("companyId", "date");

-- AddForeignKey
ALTER TABLE "AlcoholCheck" ADD CONSTRAINT "AlcoholCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

