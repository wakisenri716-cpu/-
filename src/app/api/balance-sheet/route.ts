import { NextResponse } from "next/server";
import { getBalanceSheet } from "@/lib/accounting/balanceSheet";
import { getDefaultCompanyId } from "@/lib/demo";

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const sheet = await getBalanceSheet(companyId);
  return NextResponse.json(sheet);
}
