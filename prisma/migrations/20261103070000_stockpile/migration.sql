-- CreateTable
CREATE TABLE "StockpileItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "amountPerUnit" DOUBLE PRECISION,
    "expiresOn" TEXT,
    "place" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockpileItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockpileItem_companyId_idx" ON "StockpileItem"("companyId");

-- AddForeignKey
ALTER TABLE "StockpileItem" ADD CONSTRAINT "StockpileItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

