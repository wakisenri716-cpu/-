-- CreateTable
CREATE TABLE "ChangeNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "staffId" TEXT,
    "kind" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "effectiveOn" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reply" TEXT,
    "decidedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeNotice_companyId_status_idx" ON "ChangeNotice"("companyId", "status");

-- AddForeignKey
ALTER TABLE "ChangeNotice" ADD CONSTRAINT "ChangeNotice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

