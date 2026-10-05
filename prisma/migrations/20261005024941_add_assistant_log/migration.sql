-- CreateTable
CREATE TABLE "AssistantLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "tools" TEXT[],
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantLog_companyId_createdAt_idx" ON "AssistantLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistantLog" ADD CONSTRAINT "AssistantLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

