import { requireCompanyId } from "@/lib/auth/session";
import { getDepartmentPL } from "@/lib/accounting/departments";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const pl = await getDepartmentPL(companyId, toRange(period));
  const rows: (string | number)[][] = [["区分", "科目コード", "科目名", ...pl.columns.map((c) => c.name), "合計"]];
  const push = (kind: string, code: string, name: string, line: { amounts: Record<string, number>; total: number }) =>
    rows.push([kind, code, name, ...pl.columns.map((c) => line.amounts[c.id] ?? 0), line.total]);
  for (const r of pl.revenue) push("収益", r.code, r.name, r);
  push("", "", "収益合計", pl.revenueTotal);
  for (const r of pl.expense) push("費用", r.code, r.name, r);
  push("", "", "費用合計", pl.expenseTotal);
  push("", "", "利益", pl.profit);
  return csvResponse(`部門別損益_${period.from ?? "最初"}_${period.to ?? "最新"}.csv`, rows);
}
