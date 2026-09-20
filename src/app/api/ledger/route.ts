import { NextResponse } from "next/server";
import { getAccountBalances, getAccountLedger } from "@/lib/accounting/ledger";
import { getDefaultCompanyId } from "@/lib/demo";

export async function GET(request: Request) {
  const companyId = await getDefaultCompanyId();
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");

  if (accountId) {
    const ledger = await getAccountLedger(companyId, accountId);
    return NextResponse.json(ledger);
  }

  const balances = await getAccountBalances(companyId);
  return NextResponse.json(balances);
}
