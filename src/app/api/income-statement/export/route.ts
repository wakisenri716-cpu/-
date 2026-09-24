import { getIncomeStatement, getIncomeStatementComparison } from "@/lib/accounting/incomeStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const filename = `損益計算書_${period.from ?? "最初"}_${period.to ?? "最新"}.csv`;
  const comparison = await getIncomeStatementComparison(companyId, period);

  // 期間が決まっていれば前年同期との比較つき
  if (comparison) {
    const rows: (string | number)[][] = [["区分", "科目コード", "科目名", "当期", "前年同期", "増減"]];
    for (const r of comparison.revenue) rows.push(["収益", r.code, r.name, r.current, r.prior, r.current - r.prior]);
    rows.push(["", "", "収益合計", comparison.totals.revenue.current, comparison.totals.revenue.prior, comparison.totals.revenue.current - comparison.totals.revenue.prior]);
    for (const r of comparison.expense) rows.push(["費用", r.code, r.name, r.current, r.prior, r.current - r.prior]);
    rows.push(["", "", "費用合計", comparison.totals.expense.current, comparison.totals.expense.prior, comparison.totals.expense.current - comparison.totals.expense.prior]);
    rows.push(["", "", "当期純利益", comparison.totals.net.current, comparison.totals.net.prior, comparison.totals.net.current - comparison.totals.net.prior]);
    return csvResponse(filename, rows);
  }

  const { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome } = await getIncomeStatement(companyId, toRange(period));
  const rows: (string | number)[][] = [["区分", "科目コード", "科目名", "金額"]];
  for (const row of revenueRows) rows.push(["収益", row.account.code, row.account.name, row.balance]);
  rows.push(["", "", "収益合計", totalRevenue]);
  for (const row of expenseRows) rows.push(["費用", row.account.code, row.account.name, row.balance]);
  rows.push(["", "", "費用合計", totalExpense]);
  rows.push(["", "", "当期純利益", netIncome]);
  return csvResponse(filename, rows);
}
