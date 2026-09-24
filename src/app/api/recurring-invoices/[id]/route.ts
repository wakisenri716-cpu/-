import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteRecurringInvoice, setRecurringInvoiceActive } from "@/lib/accounting/recurringInvoices";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

async function nameOf(companyId: string, id: string) {
  return (await prisma.recurringInvoice.findFirst({ where: { id, companyId }, select: { name: true } }))?.name ?? id;
}

async function handle(fn: () => Promise<unknown>) {
  try {
    await fn();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return handle(async () => {
    await setRecurringInvoiceActive(companyId, id, body.active === true);
    await audit(body.active === true ? "定期請求を再開" : "定期請求を停止", await nameOf(companyId, id));
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return handle(async () => {
    const name = await nameOf(companyId, id);
    await deleteRecurringInvoice(companyId, id);
    await audit("定期請求を削除", name);
  });
}
