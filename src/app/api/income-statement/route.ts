import { NextResponse } from "next/server";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const statement = await getIncomeStatement(companyId, toRange(period));
  return NextResponse.json({ period, ...statement });
}
