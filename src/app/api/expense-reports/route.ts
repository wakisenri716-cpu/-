import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId, requireUser } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const reports = await prisma.expenseReport.findMany({
    where: { companyId },
    include: { items: { include: { account: true, vendor: true, aiExtraction: true } }, employee: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}

export async function POST() {
  const user = await requireUser();
  const report = await prisma.expenseReport.create({
    data: { companyId: user.companyId, employeeId: user.id, status: "DRAFT" },
  });
  return NextResponse.json(report, { status: 201 });
}
