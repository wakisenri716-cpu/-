import { getConsumptionTax } from "@/lib/accounting/consumptionTax";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const { rows, outputTotal, inputTotal, payable } = await getConsumptionTax(companyId, toRange(period));

  const csv: (string | number)[][] = [["発生元", "仮受消費税(預かった)", "仮払消費税(支払った)"]];
  for (const row of rows) csv.push([row.label, row.output, row.input]);
  csv.push(["合計", outputTotal, inputTotal]);
  csv.push(["納付見込み額(仮受−仮払)", payable, ""]);

  return csvResponse(`消費税集計_${period.from ?? "最初"}_${period.to ?? "最新"}.csv`, csv);
}
