-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "honorific" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "honorific" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT;

