-- CreateTable
CREATE TABLE "SealUse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seal" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "party" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "decidedByName" TEXT,
    "reply" TEXT,
    "doneOn" TEXT,
    "pressedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SealUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SealUse_companyId_createdAt_idx" ON "SealUse"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "SealUse" ADD CONSTRAINT "SealUse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

