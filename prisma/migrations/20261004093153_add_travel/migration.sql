-- CreateTable
CREATE TABLE "TravelPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dayTripAllowance" INTEGER NOT NULL DEFAULT 0,
    "dailyAllowance" INTEGER NOT NULL DEFAULT 0,
    "lodging" INTEGER NOT NULL DEFAULT 0,
    "overseasDaily" INTEGER NOT NULL DEFAULT 0,
    "overseasLodging" INTEGER NOT NULL DEFAULT 0,
    "effectiveDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelTrip" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "nights" INTEGER NOT NULL,
    "overseas" BOOLEAN NOT NULL DEFAULT false,
    "allowance" INTEGER NOT NULL,
    "lodging" INTEGER NOT NULL,
    "expenseReportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelPolicy_companyId_key" ON "TravelPolicy"("companyId");

-- CreateIndex
CREATE INDEX "TravelTrip_companyId_startDate_idx" ON "TravelTrip"("companyId", "startDate");

-- AddForeignKey
ALTER TABLE "TravelPolicy" ADD CONSTRAINT "TravelPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelTrip" ADD CONSTRAINT "TravelTrip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

