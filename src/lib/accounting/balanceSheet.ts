import { getAccountBalances } from "@/lib/accounting/ledger";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";

// This app doesn't do a period-end closing entry (revenue/expense accounts
// stay open, never swept into retained earnings), so a strict "assets =
// liabilities + equity accounts" check would always be off by exactly the
// net income. Instead the current period's net income is folded into 純資産
// here for display, the common approach for an interim (期中) balance sheet
// without formal closing.
export async function getBalanceSheet(companyId: string) {
  const balances = await getAccountBalances(companyId);
  const { netIncome } = await getIncomeStatement(companyId);

  const assetRows = balances.filter((row) => row.account.category === "ASSET" && row.balance !== 0);
  const liabilityRows = balances.filter((row) => row.account.category === "LIABILITY" && row.balance !== 0);
  const equityRows = balances.filter((row) => row.account.category === "EQUITY" && row.balance !== 0);

  const totalAssets = assetRows.reduce((sum, row) => sum + row.balance, 0);
  const totalLiabilities = liabilityRows.reduce((sum, row) => sum + row.balance, 0);
  const totalEquityAccounts = equityRows.reduce((sum, row) => sum + row.balance, 0);
  const totalEquity = totalEquityAccounts + netIncome;
  const balanced = totalAssets === totalLiabilities + totalEquity;

  return {
    assetRows,
    liabilityRows,
    equityRows,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquityAccounts,
    totalEquity,
    balanced,
  };
}
