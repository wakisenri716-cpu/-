-- CreateTable
CREATE TABLE "AiCorrection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fromCode" TEXT,
    "toCode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "learned" TEXT,
    "ruleId" TEXT,
    "forgotten" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCorrection_companyId_kind_key_idx" ON "AiCorrection"("companyId", "kind", "key");

-- AddForeignKey
ALTER TABLE "AiCorrection" ADD CONSTRAINT "AiCorrection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

