-- CreateTable
CREATE TABLE "AssistantProposal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultId" TEXT,
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantProposal_companyId_status_idx" ON "AssistantProposal"("companyId", "status");

-- AddForeignKey
ALTER TABLE "AssistantProposal" ADD CONSTRAINT "AssistantProposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

