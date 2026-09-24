import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";

import { createRecurring, listRecurring } from "@/lib/accounting/recurring";
import { parseRecurringBody } from "./parse";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  const [entries, accounts] = await Promise.all([
    listRecurring(companyId),
    prisma.account.findMany({ where: { companyId, hidden: false }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return NextResponse.json({ entries, accounts });
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const entry = await createRecurring(companyId, parseRecurringBody(body));
    await audit("定期取引を登録", entry.name);
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
