-- CreateTable
CREATE TABLE "BentoShop" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "menu" JSONB NOT NULL,
    "cutoff" TEXT NOT NULL DEFAULT '10:00',
    "weekdays" INTEGER[],
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BentoShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BentoOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BentoOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BentoShop_companyId_idx" ON "BentoShop"("companyId");

-- CreateIndex
CREATE INDEX "BentoOrder_companyId_date_idx" ON "BentoOrder"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BentoOrder_shopId_date_userId_itemId_key" ON "BentoOrder"("shopId", "date", "userId", "itemId");

-- AddForeignKey
ALTER TABLE "BentoShop" ADD CONSTRAINT "BentoShop_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BentoOrder" ADD CONSTRAINT "BentoOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "BentoShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

