import { getAccountBalances } from "@/lib/accounting/ledger";
import type { DateRange } from "./period";

export async function getIncomeStatement(companyId: string, range: DateRange = {}) {
  const balances = await getAccountBalances(companyId, range);

  const revenueRows = balances.filter((row) => row.account.category === "REVENUE" && row.balance !== 0);
  const expenseRows = balances.filter((row) => row.account.category === "EXPENSE" && row.balance !== 0);

  const totalRevenue = revenueRows.reduce((sum, row) => sum + row.balance, 0);
  const totalExpense = expenseRows.reduce((sum, row) => sum + row.balance, 0);
  const netIncome = totalRevenue - totalExpense;

  return { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome };
}
