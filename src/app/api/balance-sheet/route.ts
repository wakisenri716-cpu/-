import { NextResponse } from "next/server";
import { getBalanceSheet } from "@/lib/accounting/balanceSheet";
import { requireCompanyId } from "@/lib/auth/session";

export async function GET() {
  const companyId = await requireCompanyId();
  const sheet = await getBalanceSheet(companyId);
  return NextResponse.json(sheet);
}
