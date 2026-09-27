import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createCashAdvance, listCashAdvances } from "@/lib/accounting/cashAdvances";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listCashAdvances(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const advance = await createCashAdvance(companyId, body);
    await audit("仮払金を渡した", `${advance.employee.name} ${advance.purpose} ${yen(advance.amount)}`);
    return NextResponse.json(advance, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
