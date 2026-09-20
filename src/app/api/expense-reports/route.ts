import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";
import { requireCurrentUserId } from "@/lib/auth";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const reports = await prisma.expenseReport.findMany({
    where: { companyId },
    include: { items: { include: { account: true, vendor: true, aiExtraction: true } }, employee: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}

export async function POST() {
  const companyId = await getDefaultCompanyId();
  try {
    const employeeId = await requireCurrentUserId();
    const report = await prisma.expenseReport.create({
      data: { companyId, employeeId, status: "DRAFT" },
    });
    return NextResponse.json(report, { status: 201 });
  } catch {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
}
