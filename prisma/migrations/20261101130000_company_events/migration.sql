-- CreateTable
CREATE TABLE "CompanyEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "place" TEXT,
    "fee" INTEGER,
    "deadline" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAnswer" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "comment" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyEvent_companyId_date_idx" ON "CompanyEvent"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EventAnswer_eventId_userId_key" ON "EventAnswer"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "CompanyEvent" ADD CONSTRAINT "CompanyEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAnswer" ADD CONSTRAINT "EventAnswer_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CompanyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

