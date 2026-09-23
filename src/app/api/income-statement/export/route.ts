import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { requireCompanyId } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv";

export async function GET() {
  const companyId = await requireCompanyId();
  const { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome } = await getIncomeStatement(companyId);

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

  return csvResponse("income_statement.csv", rows);
}
