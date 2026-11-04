-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "contents" TEXT,
    "method" TEXT NOT NULL,
    "carrier" TEXT,
    "tracking" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "paidBy" TEXT NOT NULL DEFAULT 'CASH',
    "byName" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_companyId_date_idx" ON "Shipment"("companyId", "date");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

