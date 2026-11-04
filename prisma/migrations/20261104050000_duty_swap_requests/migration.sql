-- CreateTable
CREATE TABLE "DutySwapRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutySwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutySwapRequest_companyId_toUserId_idx" ON "DutySwapRequest"("companyId", "toUserId");

