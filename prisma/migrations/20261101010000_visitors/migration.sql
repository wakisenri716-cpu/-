-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "visitorName" TEXT NOT NULL,
    "visitorCompany" TEXT,
    "partyKind" TEXT,
    "partyId" TEXT,
    "hostUserId" TEXT,
    "hostName" TEXT,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "arrivedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visitor_companyId_date_idx" ON "Visitor"("companyId", "date");

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

