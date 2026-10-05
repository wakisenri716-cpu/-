-- CreateTable
CREATE TABLE "ApprovalCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalCheck_companyId_idx" ON "ApprovalCheck"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalCheck_targetType_targetId_key" ON "ApprovalCheck"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "ApprovalCheck" ADD CONSTRAINT "ApprovalCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

