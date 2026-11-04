-- CreateTable
CREATE TABLE "CardOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "nameKana" TEXT,
    "nameEn" TEXT,
    "title" TEXT,
    "titleEn" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 100,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "orderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardOrder_companyId_status_idx" ON "CardOrder"("companyId", "status");

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

