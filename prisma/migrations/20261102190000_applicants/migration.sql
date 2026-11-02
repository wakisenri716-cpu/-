-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "appliedOn" TEXT NOT NULL,
    "interviewDate" TEXT,
    "interviewTime" TEXT,
    "interviewerId" TEXT,
    "interviewerName" TEXT,
    "visitorId" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Applicant_companyId_status_idx" ON "Applicant"("companyId", "status");

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

