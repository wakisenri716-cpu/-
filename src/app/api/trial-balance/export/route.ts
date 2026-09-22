import { getAccountBalances } from "@/lib/accounting/ledger";
import { getDefaultCompanyId } from "@/lib/demo";
import { csvResponse } from "@/lib/csv";

const CATEGORY_LABELS: Record<string, string> = {
  ASSET: "資産",
  LIABILITY: "負債",
  EQUITY: "純資産",
  REVENUE: "収益",
  EXPENSE: "費用",
};

export async function GET() {
  const companyId = await getDefaultCompanyId();
  const balances = await getAccountBalances(companyId);

  const rows: (string | number)[][] = [["科目コード", "科目名", "区分", "借方合計", "貸方合計", "残高"]];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of balances) {
    if (row.totalDebit === 0 && row.totalCredit === 0) continue;
    rows.push([
      row.account.code,
      row.account.name,
      CATEGORY_LABELS[row.account.category] ?? row.account.category,
      row.totalDebit,
      row.totalCredit,
      row.balance,
    ]);
    totalDebit += row.totalDebit;
    totalCredit += row.totalCredit;
  }
  rows.push(["", "合計", "", totalDebit, totalCredit, ""]);

  return csvResponse("trial_balance.csv", rows);
}
