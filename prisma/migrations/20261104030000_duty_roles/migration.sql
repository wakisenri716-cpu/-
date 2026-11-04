-- CreateTable
CREATE TABLE "DutyRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "memberIds" TEXT[],
    "startDate" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutySwap" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutySwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutyRole_companyId_idx" ON "DutyRole"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DutySwap_roleId_date_key" ON "DutySwap"("roleId", "date");

-- AddForeignKey
ALTER TABLE "DutyRole" ADD CONSTRAINT "DutyRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutySwap" ADD CONSTRAINT "DutySwap_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "DutyRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

