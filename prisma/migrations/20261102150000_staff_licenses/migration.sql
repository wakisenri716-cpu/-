-- CreateTable
CREATE TABLE "StaffLicense" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "holderUserId" TEXT,
    "holderName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "number" TEXT,
    "expiresOn" TEXT,
    "checkedOn" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffLicense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffLicense_companyId_idx" ON "StaffLicense"("companyId");

-- AddForeignKey
ALTER TABLE "StaffLicense" ADD CONSTRAINT "StaffLicense_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

