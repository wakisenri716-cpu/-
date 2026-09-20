import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId, getDefaultEmployeeId } from "@/lib/demo";

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
  const employeeId = await getDefaultEmployeeId();
  const report = await prisma.expenseReport.create({
    data: { companyId, employeeId, status: "DRAFT" },
  });
  return NextResponse.json(report, { status: 201 });
}
