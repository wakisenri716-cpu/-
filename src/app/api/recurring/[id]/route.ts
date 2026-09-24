import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";

import { deleteRecurring, setRecurringActive, updateRecurring } from "@/lib/accounting/recurring";
import { parseRecurringBody } from "../parse";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

async function recurringName(companyId: string, id: string) {
  return (await prisma.recurringEntry.findFirst({ where: { id, companyId }, select: { name: true } }))?.name ?? id;
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

export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return handle(async () => {
    const entry = await updateRecurring(companyId, id, parseRecurringBody(body));
    await audit("定期取引を変更", entry.name);
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return handle(async () => {
    await setRecurringActive(companyId, id, body.active === true);
    await audit(body.active === true ? "定期取引を再開" : "定期取引を停止", await recurringName(companyId, id));
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return handle(async () => {
    const name = await recurringName(companyId, id);
    await deleteRecurring(companyId, id);
    await audit("定期取引を削除", name);
  });
}
