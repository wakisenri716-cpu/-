import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { approveExpenseReport } from "@/lib/accounting/reimbursement";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const user = await requireUser();
  try {
    await approveExpenseReport(companyId, id, user.name);
    const report = await prisma.expenseReport.findFirst({ where: { id, companyId }, include: { employee: { select: { name: true } } } });
    await audit("経費精算を承認", report ? `${report.employee.name}さんの経費精算` : id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
