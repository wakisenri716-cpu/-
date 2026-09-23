import { NextResponse } from "next/server";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const balances = await getAccountBalances(companyId);

  const totalDebit = balances.reduce((sum, row) => sum + row.totalDebit, 0);
  const totalCredit = balances.reduce((sum, row) => sum + row.totalCredit, 0);

  return NextResponse.json({ rows: balances, totalDebit, totalCredit, balanced: totalDebit === totalCredit });
}
