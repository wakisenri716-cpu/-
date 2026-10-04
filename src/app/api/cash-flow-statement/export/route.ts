import { cashFlowCsvRows, getCashFlowStatement } from "@/lib/accounting/cashFlowStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const cf = await getCashFlowStatement(companyId, toRange(period));
  return csvResponse(`キャッシュ・フロー計算書_${period.from ?? "最初"}_${period.to ?? "最新"}.csv`, cashFlowCsvRows(cf));
}
