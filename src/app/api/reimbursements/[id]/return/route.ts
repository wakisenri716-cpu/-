import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { returnExpenseReport } from "@/lib/accounting/reimbursement";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    await returnExpenseReport(companyId, id, String(body.comment ?? ""));
    const report = await prisma.expenseReport.findFirst({ where: { id, companyId }, include: { employee: { select: { name: true } } } });
    await audit("経費精算を差戻し", `${report?.employee.name ?? ""}さん: ${String(body.comment ?? "").slice(0, 100)}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
