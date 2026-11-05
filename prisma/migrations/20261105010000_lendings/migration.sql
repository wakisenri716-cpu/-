-- CreateTable
CREATE TABLE "Lending" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "borrowerId" TEXT,
    "borrowerName" TEXT NOT NULL,
    "lentOn" TEXT NOT NULL,
    "dueOn" TEXT,
    "returnedOn" TEXT,
    "note" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lending_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lending_companyId_returnedOn_idx" ON "Lending"("companyId", "returnedOn");

-- AddForeignKey
ALTER TABLE "Lending" ADD CONSTRAINT "Lending_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

