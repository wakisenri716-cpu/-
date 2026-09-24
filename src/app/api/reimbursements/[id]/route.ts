import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { reimburse, ReimbursementError, undoReimbursement } from "@/lib/accounting/reimbursement";
import { audit } from "@/lib/audit";

async function reportLabel(companyId: string, id: string) {
  const report = await prisma.expenseReport.findFirst({ where: { id, companyId }, include: { employee: { select: { name: true } } } });
  return report ? `${report.employee.name}さんの経費精算` : id;
}

async function handle(fn: () => Promise<unknown>) {
  try {
    await fn();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ReimbursementError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return handle(async () => {
    await reimburse(companyId, id, { date: body.date ? String(body.date) : undefined, payFrom: body.payFrom ? String(body.payFrom) : undefined });
    await audit("立替経費を精算", await reportLabel(companyId, id));
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return handle(async () => {
    await undoReimbursement(companyId, id);
    await audit("立替経費の精算を取消", await reportLabel(companyId, id));
  });
}
