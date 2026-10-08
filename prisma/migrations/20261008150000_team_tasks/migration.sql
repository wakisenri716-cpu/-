-- CreateTable
CREATE TABLE "TeamTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "dueOn" TEXT,
    "partyKind" TEXT,
    "partyId" TEXT,
    "partyName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "doneAt" TIMESTAMP(3),
    "doneByName" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamTask_companyId_status_idx" ON "TeamTask"("companyId", "status");

-- CreateIndex
CREATE INDEX "TeamTask_companyId_partyKind_partyId_idx" ON "TeamTask"("companyId", "partyKind", "partyId");

-- AddForeignKey
ALTER TABLE "TeamTask" ADD CONSTRAINT "TeamTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
