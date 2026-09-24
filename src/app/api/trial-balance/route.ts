import { NextResponse } from "next/server";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { requireCompanyId } from "@/lib/auth/session";
import { nextDay, paramsFromUrl, resolveAsOf } from "@/lib/accounting/period";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const { asOf } = resolveAsOf(paramsFromUrl(request.url));
  const balances = await getAccountBalances(companyId, { lt: nextDay(asOf) });

  const totalDebit = balances.reduce((sum, row) => sum + row.totalDebit, 0);
  const totalCredit = balances.reduce((sum, row) => sum + row.totalCredit, 0);

  return NextResponse.json({ asOf, rows: balances, totalDebit, totalCredit, balanced: totalDebit === totalCredit });
}
