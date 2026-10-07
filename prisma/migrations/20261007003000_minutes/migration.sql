-- CreateTable
CREATE TABLE "Minutes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "heldOn" TIMESTAMP(3) NOT NULL,
    "place" TEXT,
    "attendees" TEXT[],
    "content" JSONB NOT NULL,
    "notes" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'template',
    "announcementId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Minutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Minutes_companyId_heldOn_idx" ON "Minutes"("companyId", "heldOn");

-- AddForeignKey
ALTER TABLE "Minutes" ADD CONSTRAINT "Minutes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

