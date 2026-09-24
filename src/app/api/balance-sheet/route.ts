import { NextResponse } from "next/server";
import { getBalanceSheet } from "@/lib/accounting/balanceSheet";
import { requireCompanyId } from "@/lib/auth/session";
import { paramsFromUrl, resolveAsOf } from "@/lib/accounting/period";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const { asOf } = resolveAsOf(paramsFromUrl(request.url));
  const sheet = await getBalanceSheet(companyId, asOf);
  return NextResponse.json({ asOf, ...sheet });
}
