-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "representative" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;


-- 住所か電話が入っている会社は、会社情報を入力済みとみなす(ようこそ画面を出さない)
UPDATE "Company" SET "onboardedAt" = CURRENT_TIMESTAMP WHERE "address" IS NOT NULL OR "phone" IS NOT NULL;
