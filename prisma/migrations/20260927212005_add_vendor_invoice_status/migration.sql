-- CreateEnum
CREATE TYPE "VendorInvoiceStatus" AS ENUM ('REGISTERED', 'NOT_REGISTERED');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "invoiceStatus" "VendorInvoiceStatus",
ADD COLUMN     "registrationNumber" TEXT;

