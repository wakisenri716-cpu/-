import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { getBankTransactions } from "@/lib/bank/process";

export async function GET() {
  const companyId = await requireCompanyId();
  await ensureChartOfAccounts(companyId);
  return NextResponse.json(await getBankTransactions(companyId));
}
