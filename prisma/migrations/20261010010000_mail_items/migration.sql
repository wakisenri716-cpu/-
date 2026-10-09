-- CreateTable
CREATE TABLE "MailItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LETTER',
    "sender" TEXT,
    "partyKind" TEXT,
    "partyId" TEXT,
    "forUserId" TEXT,
    "forName" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "handedAt" TIMESTAMP(3),
    "handedTo" TEXT,
    "takenByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailItem_companyId_status_idx" ON "MailItem"("companyId", "status");

-- AddForeignKey
ALTER TABLE "MailItem" ADD CONSTRAINT "MailItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
