import { getBalanceSheet } from "@/lib/accounting/balanceSheet";
import { requireCompanyId } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv";

export async function GET() {
  const companyId = await requireCompanyId();
  const { assetRows, liabilityRows, equityRows, netIncome, totalAssets, totalLiabilities, totalEquity } =
    await getBalanceSheet(companyId);

  const rows: (string | number)[][] = [["区分", "科目コード", "科目名", "金額"]];
  for (const row of assetRows) {
    rows.push(["資産", row.account.code, row.account.name, row.balance]);
  }
  rows.push(["", "", "資産合計", totalAssets]);
  for (const row of liabilityRows) {
    rows.push(["負債", row.account.code, row.account.name, row.balance]);
  }
  rows.push(["", "", "負債合計", totalLiabilities]);
  for (const row of equityRows) {
    rows.push(["純資産", row.account.code, row.account.name, row.balance]);
  }
  rows.push(["純資産", "", "当期純利益", netIncome]);
  rows.push(["", "", "純資産合計", totalEquity]);

  return csvResponse("balance_sheet.csv", rows);
}
