-- DropIndex
DROP INDEX "Staff_userId_key";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "CompanyMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyMember_companyId_idx" ON "CompanyMember"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMember_userId_companyId_key" ON "CompanyMember"("userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_companyId_userId_key" ON "Staff"("companyId", "userId");

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- これまでのユーザーを、それぞれの会社のメンバーにする(権限・利用停止もそのまま引き継ぐ)
INSERT INTO "CompanyMember" ("id", "userId", "companyId", "role", "active", "createdAt")
SELECT 'cm_' || "id", "id", "companyId", "role", "active", "createdAt" FROM "User"
ON CONFLICT ("userId", "companyId") DO NOTHING;
