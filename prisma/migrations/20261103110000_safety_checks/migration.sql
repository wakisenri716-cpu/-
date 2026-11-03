-- CreateTable
CREATE TABLE "SafetyCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAnswer" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "canWork" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyCheck_companyId_createdAt_idx" ON "SafetyCheck"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyAnswer_checkId_userId_key" ON "SafetyAnswer"("checkId", "userId");

-- AddForeignKey
ALTER TABLE "SafetyCheck" ADD CONSTRAINT "SafetyCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAnswer" ADD CONSTRAINT "SafetyAnswer_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "SafetyCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

