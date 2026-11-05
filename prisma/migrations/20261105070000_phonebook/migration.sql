-- CreateTable
CREATE TABLE "PhoneEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "department" TEXT,
    "extension" TEXT,
    "direct" TEXT,
    "mobile" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneEntry_companyId_name_key" ON "PhoneEntry"("companyId", "name");

-- AddForeignKey
ALTER TABLE "PhoneEntry" ADD CONSTRAINT "PhoneEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

