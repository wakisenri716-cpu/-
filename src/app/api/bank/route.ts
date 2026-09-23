import { NextResponse } from "next/server";
import { getDefaultCompanyId } from "@/lib/demo";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { getBankTransactions } from "@/lib/bank/process";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  await ensureChartOfAccounts(companyId);
  return NextResponse.json(await getBankTransactions(companyId));
}
