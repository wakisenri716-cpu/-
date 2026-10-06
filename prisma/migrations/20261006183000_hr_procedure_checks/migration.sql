-- CreateTable
CREATE TABLE "HrProcedureCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrProcedureCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrProcedureCheck_companyId_idx" ON "HrProcedureCheck"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "HrProcedureCheck_staffId_key_key" ON "HrProcedureCheck"("staffId", "key");

-- AddForeignKey
ALTER TABLE "HrProcedureCheck" ADD CONSTRAINT "HrProcedureCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrProcedureCheck" ADD CONSTRAINT "HrProcedureCheck_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

