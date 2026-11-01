-- CreateTable
CREATE TABLE "StaffQuestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "aiReply" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredByName" TEXT,
    "answeredAt" TIMESTAMP(3),
    "manualId" TEXT,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffQuestion_companyId_status_idx" ON "StaffQuestion"("companyId", "status");

-- CreateIndex
CREATE INDEX "StaffQuestion_userId_idx" ON "StaffQuestion"("userId");

-- AddForeignKey
ALTER TABLE "StaffQuestion" ADD CONSTRAINT "StaffQuestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

