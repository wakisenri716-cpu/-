-- CreateTable
CREATE TABLE "LostItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "place" TEXT,
    "foundOn" TEXT NOT NULL,
    "foundById" TEXT NOT NULL,
    "foundByName" TEXT NOT NULL,
    "keptAt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FOUND',
    "claimedById" TEXT,
    "claimedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LostItem_companyId_status_idx" ON "LostItem"("companyId", "status");

-- AddForeignKey
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

