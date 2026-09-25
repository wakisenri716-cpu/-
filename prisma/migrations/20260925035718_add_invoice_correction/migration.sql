-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "correctionReason" TEXT,
ADD COLUMN     "correctsInvoiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_correctsInvoiceId_key" ON "Invoice"("correctsInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_correctsInvoiceId_fkey" FOREIGN KEY ("correctsInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

