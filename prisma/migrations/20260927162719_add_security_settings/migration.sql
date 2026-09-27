-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "allowedIps" TEXT,
ADD COLUMN     "loginAlert" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "require2fa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessionIdleMinutes" INTEGER;

