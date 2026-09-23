import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const entries = await prisma.journalEntry.findMany({
    where: { companyId, status: "PENDING_REVIEW" },
    include: {
      lines: { include: { account: true } },
      expenseItem: { include: { expenseReport: { include: { employee: true } }, vendor: true, account: true, aiExtraction: true } },
      invoice: { include: { vendor: true, customer: true, aiExtraction: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(entries);
}
