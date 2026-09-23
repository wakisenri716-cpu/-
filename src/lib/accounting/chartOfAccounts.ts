export type SeedAccount = {
  code: string;
  name: string;
  category: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
};

// Minimal Japanese SME chart of accounts covering expenses, payables,
// receivables, sales and the clearing accounts the automation engine posts to.
export const CHART_OF_ACCOUNTS: SeedAccount[] = [
  { code: "1010", name: "現金", category: "ASSET" },
  { code: "1020", name: "普通預金", category: "ASSET" },
  { code: "1110", name: "売掛金", category: "ASSET" },
  { code: "1115", name: "クレジット売掛金", category: "ASSET" },
  { code: "1210", name: "仮払金", category: "ASSET" },
  { code: "1220", name: "仮払消費税", category: "ASSET" },
  { code: "1510", name: "固定資産", category: "ASSET" },
  { code: "2010", name: "買掛金", category: "LIABILITY" },
  { code: "2020", name: "未払金", category: "LIABILITY" },
  { code: "2110", name: "仮受消費税", category: "LIABILITY" },
  // 本来は資産の控除項目(contra-asset)だが、本アプリの残高計算は
  // 科目区分から正常残高の貸借を決めるだけのシンプルな仕組みのため、
  // 貸方残高を正しく扱えるよう暫定的に LIABILITY として登録している。
  { code: "1519", name: "減価償却累計額", category: "LIABILITY" },
  { code: "4010", name: "売上高", category: "REVENUE" },
  { code: "5010", name: "旅費交通費", category: "EXPENSE" },
  { code: "5020", name: "会議費", category: "EXPENSE" },
  { code: "5030", name: "消耗品費", category: "EXPENSE" },
  { code: "5040", name: "通信費", category: "EXPENSE" },
  { code: "5050", name: "接待交際費", category: "EXPENSE" },
  { code: "5060", name: "地代家賃", category: "EXPENSE" },
  { code: "5070", name: "水道光熱費", category: "EXPENSE" },
  { code: "5080", name: "支払手数料", category: "EXPENSE" },
  { code: "5090", name: "外注費", category: "EXPENSE" },
  { code: "5100", name: "減価償却費", category: "EXPENSE" },
  { code: "5990", name: "雑費", category: "EXPENSE" },
];

export const EXPENSE_ACCOUNT_CODES = CHART_OF_ACCOUNTS.filter(
  (a) => a.category === "EXPENSE",
).map((a) => a.code);

export function accountLabel(code: string): string {
  const account = CHART_OF_ACCOUNTS.find((a) => a.code === code);
  return account ? `${account.code} ${account.name}` : code;
}
