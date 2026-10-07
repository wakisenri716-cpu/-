-- CreateTable
CREATE TABLE "PartyNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partyKind" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyNote_companyId_partyKind_partyId_idx" ON "PartyNote"("companyId", "partyKind", "partyId");

-- AddForeignKey
ALTER TABLE "PartyNote" ADD CONSTRAINT "PartyNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

