-- CreateTable
CREATE TABLE "StandardReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "appliedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandardReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StandardReview_companyId_year_key" ON "StandardReview"("companyId", "year");

-- AddForeignKey
ALTER TABLE "StandardReview" ADD CONSTRAINT "StandardReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

