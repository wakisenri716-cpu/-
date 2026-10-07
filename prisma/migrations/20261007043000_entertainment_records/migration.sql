-- CreateTable
CREATE TABLE "EntertainmentRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "journalLineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MEAL',
    "persons" INTEGER,
    "guests" TEXT,
    "purpose" TEXT,
    "byName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntertainmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntertainmentRecord_journalLineId_key" ON "EntertainmentRecord"("journalLineId");

-- CreateIndex
CREATE INDEX "EntertainmentRecord_companyId_idx" ON "EntertainmentRecord"("companyId");

-- AddForeignKey
ALTER TABLE "EntertainmentRecord" ADD CONSTRAINT "EntertainmentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

