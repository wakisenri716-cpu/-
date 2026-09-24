import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth/session";

export async function GET() {
  const user = await requireMember();
  // 従業員には自分の経費精算だけを見せる
  const reports = await prisma.expenseReport.findMany({
    where: { companyId: user.companyId, ...(user.role === "EMPLOYEE" ? { employeeId: user.id } : {}) },
    include: { items: { include: { account: true, vendor: true, aiExtraction: true } }, employee: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}

export async function POST() {
  const user = await requireMember();
  const report = await prisma.expenseReport.create({
    data: { companyId: user.companyId, employeeId: user.id, status: "DRAFT" },
  });
  return NextResponse.json(report, { status: 201 });
}
