-- CreateTable
CREATE TABLE "PhoneMemo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CALL',
    "callerName" TEXT,
    "callerCompany" TEXT,
    "callerPhone" TEXT,
    "partyKind" TEXT,
    "partyId" TEXT,
    "forUserId" TEXT,
    "forName" TEXT,
    "message" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'CALLBACK',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "takenByName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "doneAt" TIMESTAMP(3),
    "doneNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneMemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneMemo_companyId_status_idx" ON "PhoneMemo"("companyId", "status");

-- AddForeignKey
ALTER TABLE "PhoneMemo" ADD CONSTRAINT "PhoneMemo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

