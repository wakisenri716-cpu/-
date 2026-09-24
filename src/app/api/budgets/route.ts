import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { BudgetError, getBudgets, saveBudgets } from "@/lib/accounting/monthly";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return NextResponse.json(await getBudgets(companyId, new URL(request.url).searchParams.get("fy")));
}

export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  const entries = Array.isArray(body.budgets) ? body.budgets : [];
  try {
    await saveBudgets(
      companyId,
      Number(body.fiscalYear),
      entries.map((e: { accountId?: unknown; amount?: unknown }) => ({
        accountId: String(e.accountId ?? ""),
        amount: e.amount === null || e.amount === "" || e.amount === undefined ? null : Number(e.amount),
      })),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BudgetError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
