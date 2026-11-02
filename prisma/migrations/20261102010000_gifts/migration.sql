-- CreateTable
CREATE TABLE "GiftRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "partyKind" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "item" TEXT,
    "amount" INTEGER,
    "thankedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiftRecord_companyId_year_idx" ON "GiftRecord"("companyId", "year");

-- AddForeignKey
ALTER TABLE "GiftRecord" ADD CONSTRAINT "GiftRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

