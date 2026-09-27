-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "transferSource" JSONB;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "payeeAccount" JSONB;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "payeeAccount" JSONB;

