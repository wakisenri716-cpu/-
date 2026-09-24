import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome } = await getIncomeStatement(companyId, toRange(period));

  const rows: (string | number)[][] = [["区分", "科目コード", "科目名", "金額"]];
  for (const row of revenueRows) {
    rows.push(["収益", row.account.code, row.account.name, row.balance]);
  }
  rows.push(["", "", "収益合計", totalRevenue]);
  for (const row of expenseRows) {
    rows.push(["費用", row.account.code, row.account.name, row.balance]);
  }
  rows.push(["", "", "費用合計", totalExpense]);
  rows.push(["", "", "当期純利益", netIncome]);

  return csvResponse(`損益計算書_${period.from ?? "最初"}_${period.to ?? "最新"}.csv`, rows);
}
