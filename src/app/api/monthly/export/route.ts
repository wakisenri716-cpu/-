import { requireCompanyId } from "@/lib/auth/session";
import { getMonthlyTable } from "@/lib/accounting/monthly";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const t = await getMonthlyTable(companyId, new URL(request.url).searchParams.get("fy"));
  const header = ["区分", "科目コード", "科目名", ...t.months.map((m) => `${Number(m.slice(5))}月`), "合計", "年間予算"];
  const rows: (string | number)[][] = [header];
  const push = (kind: string, code: string, name: string, line: { months: number[]; total: number; budget: number | null }) =>
    rows.push([kind, code, name, ...line.months, line.total, line.budget ?? ""]);
  for (const r of t.revenue) push("収益", r.code, r.name, r);
  push("", "", "収益合計", t.revenueTotal);
  for (const r of t.expense) push("費用", r.code, r.name, r);
  push("", "", "費用合計", t.expenseTotal);
  push("", "", "利益", t.profit);
  return csvResponse(`月次推移表_${t.year}年度.csv`, rows);
}
