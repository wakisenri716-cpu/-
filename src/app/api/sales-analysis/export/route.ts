import { requireCompanyId } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv";
import { getSalesAnalysis, salesAnalysisCsv } from "@/lib/accounting/salesAnalysis";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod } from "@/lib/accounting/period";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const analysis = await getSalesAnalysis(companyId, period);
  return csvResponse(`売上分析_${period.from ?? "all"}_${period.to ?? "all"}.csv`, salesAnalysisCsv(analysis));
}
