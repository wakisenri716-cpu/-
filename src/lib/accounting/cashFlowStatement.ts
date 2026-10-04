import { getAccountBalances } from "@/lib/accounting/ledger";
import { cashAccountCodes } from "@/lib/bank/accounts";
import type { DateRange } from "./period";

// キャッシュ・フロー計算書(間接法)。期間の仕訳の動きと、期首・期末の残高の差から作る。
// 区分は勘定科目コードで決める(決算報告書と同じ):
//   資産 1000〜1499 流動(現金・預金を除く)→ 営業 / 1500〜 固定 → 投資
//   負債 2000〜2199 流動 → 営業 / 2200〜 固定(借入金など)→ 財務、純資産 → 財務
// すべての科目をどこかの区分に入れるので、「増減額」は現金・預金の実際の増減と必ず一致する。

const DEPRECIATION = "5100"; // 減価償却費
const ACCUMULATED_DEPRECIATION = "1519"; // 減価償却累計額(資産のマイナス。科目の区分上は負債)
const GAIN_ON_SALE = "4030"; // 固定資産売却益
const LOSS_ON_DISPOSAL = "5160"; // 固定資産除売却損
const INTEREST = "5150"; // 支払利息
const RETAINED_EARNINGS = "3020";
const INCOME_TAX = "5900"; // 法人税等
// 法人税等に関わる流動の科目(小計の下の「法人税等の支払額」にまとめる): 仮払法人税等・未収還付法人税等・未払法人税等
const TAX_ACCOUNTS = new Set(["1240", "1245", "2140"]);

// まとめて1行にする流動の科目(それ以外は科目ごとに「〇〇の増減額」)
const GROUPS: { label: string; codes: string[] }[] = [
  { label: "売上債権の増減額", codes: ["1110", "1115"] },
  { label: "棚卸資産の増減額", codes: ["1310"] },
  { label: "仕入債務の増減額", codes: ["2010"] },
];

export type CashFlowRow = { label: string; amount: number; note?: string };
type Balance = Awaited<ReturnType<typeof getAccountBalances>>[number];

const total = (rows: CashFlowRow[]) => rows.reduce((s, r) => s + r.amount, 0);
const nonZero = (rows: CashFlowRow[]) => rows.filter((r) => r.amount !== 0);

export async function getCashFlowStatement(companyId: string, range: DateRange) {
  const [movement, opening, closing, cashCodes] = await Promise.all([
    getAccountBalances(companyId, range),
    range.gte ? getAccountBalances(companyId, { lt: range.gte }) : Promise.resolve(null),
    getAccountBalances(companyId, range.lt ? { lt: range.lt } : {}),
    cashAccountCodes(companyId),
  ]);
  const isCash = (b: Balance) => cashCodes.includes(b.account.code);
  const num = (b: Balance) => Number(b.account.code);
  const of = (code: string) => movement.find((b) => b.account.code === code)?.balance ?? 0;

  // ---- 営業活動
  const revenue = movement.filter((b) => b.account.category === "REVENUE").reduce((s, b) => s + b.balance, 0);
  const expense = movement.filter((b) => b.account.category === "EXPENSE").reduce((s, b) => s + b.balance, 0);
  const incomeTaxes = of(INCOME_TAX);
  const pretaxIncome = revenue - expense + incomeTaxes;
  const depreciation = of(DEPRECIATION);
  const gain = of(GAIN_ON_SALE);
  const loss = of(LOSS_ON_DISPOSAL);
  const interest = of(INTEREST);

  // 流動資産は増えたらお金が減る(マイナス)、流動負債は増えたらお金が増える(プラス)
  const working = movement.filter(
    (b) =>
      b.balance !== 0 &&
      !TAX_ACCOUNTS.has(b.account.code) &&
      ((b.account.category === "ASSET" && !isCash(b) && num(b) < 1500) || (b.account.category === "LIABILITY" && num(b) >= 2000 && num(b) < 2200)),
  );
  const effect = (b: Balance) => (b.account.category === "ASSET" ? -b.balance : b.balance);
  const grouped = new Set(GROUPS.flatMap((g) => g.codes));
  const workingRows: CashFlowRow[] = [
    ...GROUPS.map((g) => ({ label: g.label, amount: working.filter((b) => g.codes.includes(b.account.code)).reduce((s, b) => s + effect(b), 0) })),
    ...working.filter((b) => !grouped.has(b.account.code)).map((b) => ({ label: `${b.account.name}の増減額`, amount: effect(b) })),
  ];

  const operatingRows = [
    { label: "税引前当期純利益", amount: pretaxIncome },
    ...nonZero([
      { label: "減価償却費", amount: depreciation },
      { label: "固定資産除売却損", amount: loss },
      { label: "固定資産売却益", amount: -gain },
      { label: "支払利息", amount: interest },
      ...workingRows,
    ]),
  ];
  const subtotal = total(operatingRows);
  const interestPaid = -interest; // 利息は支払ったものとして、小計の下で支払額にする
  // 法人税等の支払額: 費用にした法人税等から、未払の増加・仮払(中間納付)の増加を調整した、実際に納めた額
  const taxEffect = movement.filter((b) => TAX_ACCOUNTS.has(b.account.code)).reduce((s, b) => s + (b.account.category === "ASSET" ? -b.balance : b.balance), 0);
  const taxesPaid = -incomeTaxes + taxEffect;
  const operating = subtotal + interestPaid + taxesPaid;

  // ---- 投資活動(固定資産): 取得は借方に入った額、残りは売却・除却で入ったお金
  const fixed = movement.filter((b) => b.account.category === "ASSET" && !isCash(b) && num(b) >= 1500);
  const accumulated = of(ACCUMULATED_DEPRECIATION);
  const investing = -fixed.reduce((s, b) => s + b.balance, 0) + accumulated - depreciation + gain - loss;
  const acquisitions = fixed.reduce((s, b) => s + b.totalDebit, 0);
  const investingRows = nonZero([
    { label: "固定資産の取得による支出", amount: -acquisitions },
    { label: investing + acquisitions >= 0 ? "固定資産の売却による収入" : "その他の投資による支出", amount: investing + acquisitions },
  ]);

  // ---- 財務活動: 固定負債(借入金など)は借入と返済に分け、純資産は増減
  const longTerm = movement.filter((b) => b.account.category === "LIABILITY" && num(b) >= 2200);
  const equity = movement.filter((b) => b.account.category === "EQUITY");
  const borrowed = longTerm.reduce((s, b) => s + b.totalCredit, 0);
  const repaid = longTerm.reduce((s, b) => s + b.totalDebit, 0);
  const capital = equity.filter((b) => b.account.code !== RETAINED_EARNINGS).reduce((s, b) => s + b.balance, 0);
  const retained = equity.filter((b) => b.account.code === RETAINED_EARNINGS).reduce((s, b) => s + b.balance, 0);
  const financingRows = nonZero([
    { label: "借入れによる収入", amount: borrowed },
    { label: "借入金の返済による支出", amount: -repaid },
    { label: "資本金などの増減額", amount: capital },
    { label: "配当金の支払額・その他(繰越利益剰余金の増減)", amount: retained },
  ]);
  const financing = total(financingRows);

  // ---- 現金・預金の増減と残高
  const cashBalance = (list: Balance[] | null) => (list ?? []).filter(isCash).reduce((s, b) => s + b.balance, 0);
  const change = operating + investing + financing;
  const beginning = cashBalance(opening);
  const ending = cashBalance(closing);
  const cashAccounts = closing
    .filter((b) => isCash(b) && (b.balance !== 0 || (opening ?? []).some((o) => o.account.id === b.account.id && o.balance !== 0)))
    .map((b) => ({ code: b.account.code, name: b.account.name, beginning: (opening ?? []).find((o) => o.account.id === b.account.id)?.balance ?? 0, ending: b.balance }));

  return {
    operatingRows,
    subtotal,
    interestPaid,
    taxesPaid,
    operating,
    investingRows,
    investing,
    financingRows,
    financing,
    change,
    beginning,
    ending,
    cashAccounts,
    // 仕訳の貸借がそろっていれば、増減額と残高の差は必ず一致する
    balanced: beginning + change === ending,
    freeCashFlow: operating + investing,
  };
}

export type CashFlowStatement = Awaited<ReturnType<typeof getCashFlowStatement>>;

// CSV・税理士向けデータ用の行
export function cashFlowCsvRows(cf: CashFlowStatement): (string | number)[][] {
  const rows: (string | number)[][] = [["区分", "項目", "金額"]];
  for (const r of cf.operatingRows) rows.push(["営業活動", r.label, r.amount]);
  rows.push(["営業活動", "小計", cf.subtotal]);
  if (cf.interestPaid) rows.push(["営業活動", "利息の支払額", cf.interestPaid]);
  if (cf.taxesPaid) rows.push(["営業活動", "法人税等の支払額", cf.taxesPaid]);
  rows.push(["", "営業活動によるキャッシュ・フロー", cf.operating]);
  for (const r of cf.investingRows) rows.push(["投資活動", r.label, r.amount]);
  rows.push(["", "投資活動によるキャッシュ・フロー", cf.investing]);
  for (const r of cf.financingRows) rows.push(["財務活動", r.label, r.amount]);
  rows.push(["", "財務活動によるキャッシュ・フロー", cf.financing]);
  rows.push(["", "現金及び現金同等物の増減額", cf.change]);
  rows.push(["", "現金及び現金同等物の期首残高", cf.beginning]);
  rows.push(["", "現金及び現金同等物の期末残高", cf.ending]);
  return rows;
}
