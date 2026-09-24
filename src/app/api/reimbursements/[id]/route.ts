import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { reimburse, ReimbursementError, undoReimbursement } from "@/lib/accounting/reimbursement";

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
  return handle(() => reimburse(companyId, id, { date: body.date ? String(body.date) : undefined, payFrom: body.payFrom ? String(body.payFrom) : undefined }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return handle(() => undoReimbursement(companyId, id));
}
