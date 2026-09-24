import { NextResponse } from "next/server";
import { getConsumptionTax } from "@/lib/accounting/consumptionTax";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  return NextResponse.json({ period, ...(await getConsumptionTax(companyId, toRange(period))) });
}
