-- CreateTable
CREATE TABLE "CompanyClosure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "CompanyClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClosure_companyId_date_key" ON "CompanyClosure"("companyId", "date");

-- AddForeignKey
ALTER TABLE "CompanyClosure" ADD CONSTRAINT "CompanyClosure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
