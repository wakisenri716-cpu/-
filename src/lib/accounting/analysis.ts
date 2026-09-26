import { getAccountBalances } from "@/lib/accounting/ledger";
import { lastYear } from "@/lib/accounting/incomeStatement";
import { nextDay, toRange } from "./period";
import { cashAccountCodes } from "@/lib/bank/accounts";

// 経営分析: 損益計算書・貸借対照表の数字から、よく使われる指標を計算する。
// 流動・固定の区分は勘定科目コードで判断する(資産 1000〜1499・負債 2000〜2199 を流動とみなす)。

const COST_OF_SALES = "5000"; // 売上原価
const SALES = "4010"; // 売上高
const NON_OPERATING_EXPENSE = new Set(["5150", "5160"]); // 支払利息・固定資産除売却損(営業外・特別)
const PERSONNEL = new Set(["5110", "5120"]); // 給料手当・法定福利費
const RECEIVABLES = new Set(["1110", "1115"]);
const ACCUMULATED_DEPRECIATION = "1519"; // 資産のマイナス(科目の区分上は負債に置いている)

type Figures = {
  sales: number;
  revenue: number;
  grossProfit: number;
  operatingProfit: number;
  netIncome: number;
  personnel: number;
  days: number;
  cash: number;
  receivables: number;
  currentAssets: number;
  currentLiabilities: number;
  totalAssets: number;
  equity: number;
};

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

async function figures(companyId: string, from: string, to: string): Promise<Figures> {
  const [pl, bs, cashCodes] = await Promise.all([getAccountBalances(companyId, toRange({ from, to })), getAccountBalances(companyId, { lt: nextDay(to) }), cashAccountCodes(companyId)]);
  const CASH = new Set(cashCodes); // 現金・普通預金と、登録した銀行口座

  const sum = (rows: typeof pl, pick: (r: (typeof pl)[number]) => boolean) => rows.filter(pick).reduce((s, r) => s + r.balance, 0);
  const sales = sum(pl, (r) => r.account.code === SALES);
  const revenue = sum(pl, (r) => r.account.category === "REVENUE");
  const cost = sum(pl, (r) => r.account.code === COST_OF_SALES);
  const expense = sum(pl, (r) => r.account.category === "EXPENSE");
  const sga = sum(pl, (r) => r.account.category === "EXPENSE" && r.account.code !== COST_OF_SALES && !NON_OPERATING_EXPENSE.has(r.account.code));

  // 貸借対照表の純資産には、締めていない分の利益(収益 − 費用の累計)も含める
  const cumulativeIncome = sum(bs, (r) => r.account.category === "REVENUE") - sum(bs, (r) => r.account.category === "EXPENSE");
  const depreciation = sum(bs, (r) => r.account.code === ACCUMULATED_DEPRECIATION);
  const code = (r: (typeof bs)[number]) => Number(r.account.code);

  return {
    sales,
    revenue,
    grossProfit: sales - cost,
    operatingProfit: sales - cost - sga,
    netIncome: revenue - expense,
    personnel: sum(pl, (r) => PERSONNEL.has(r.account.code)),
    days: daysBetween(from, to),
    cash: sum(bs, (r) => CASH.has(r.account.code)),
    receivables: sum(bs, (r) => RECEIVABLES.has(r.account.code)),
    currentAssets: sum(bs, (r) => r.account.category === "ASSET" && code(r) < 1500),
    currentLiabilities: sum(bs, (r) => r.account.category === "LIABILITY" && code(r) >= 2000 && code(r) < 2200),
    totalAssets: sum(bs, (r) => r.account.category === "ASSET") - depreciation,
    equity: sum(bs, (r) => r.account.category === "EQUITY") + cumulativeIncome,
  };
}

export type Metric = {
  key: string;
  group: "収益性" | "安全性" | "効率性";
  label: string;
  unit: "%" | "か月" | "日";
  current: number | null;
  prior: number | null;
  higherIsBetter: boolean;
  guide: string;
  // 目安に対する判定(良い・注意)。判定できないときは null
  good: ((v: number) => boolean) | null;
  explain: string;
};

const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

function metrics(f: Figures) {
  const monthlySales = f.sales / (f.days / (365 / 12));
  return {
    grossMargin: ratio(f.grossProfit, f.sales),
    operatingMargin: ratio(f.operatingProfit, f.sales),
    netMargin: ratio(f.netIncome, f.revenue),
    personnelRatio: ratio(f.personnel, f.sales),
    currentRatio: ratio(f.currentAssets, f.currentLiabilities),
    quickRatio: ratio(f.cash + f.receivables, f.currentLiabilities),
    equityRatio: ratio(f.equity, f.totalAssets),
    cashMonths: monthlySales > 0 ? f.cash / monthlySales : null,
    receivableDays: f.sales > 0 ? f.receivables / (f.sales / f.days) : null,
  };
}

// 期間(from〜to)と前年同期の指標。期間の終わりが未来なら、今日までで計算する。
export async function getAnalysis(companyId: string, period: { from: string; to: string }, today: string) {
  const to = period.to > today ? today : period.to;
  const from = period.from > to ? to : period.from;
  const priorFrom = lastYear(from);
  const priorTo = lastYear(to);
  const [cur, pri] = await Promise.all([figures(companyId, from, to), figures(companyId, priorFrom, priorTo)]);
  const c = metrics(cur);
  const p = metrics(pri);
  const hasPrior = pri.revenue !== 0 || pri.totalAssets !== 0;
  const pick = (k: keyof typeof c) => ({ current: c[k], prior: hasPrior ? p[k] : null });

  const list: Metric[] = [
    { key: "grossMargin", group: "収益性", label: "売上総利益率(粗利率)", unit: "%", ...pick("grossMargin"), higherIsBetter: true, guide: "業種で大きく違う(小売 25〜35%・サービス業 50%以上が多い)", good: null, explain: "売上から仕入・原価を引いた「粗利」が売上の何%か。値決めや仕入の上手さを表します。" },
    { key: "operatingMargin", group: "収益性", label: "営業利益率", unit: "%", ...pick("operatingMargin"), higherIsBetter: true, guide: "5%以上なら良好、10%以上なら優良", good: (v) => v >= 5, explain: "本業のもうけが売上の何%か。家賃・人件費などの経費を払ったあとに残る割合です。" },
    { key: "netMargin", group: "収益性", label: "純利益率", unit: "%", ...pick("netMargin"), higherIsBetter: true, guide: "プラスを維持できているか", good: (v) => v > 0, explain: "雑収入や支払利息なども含めた最終的なもうけが、収益全体の何%か。" },
    { key: "personnelRatio", group: "収益性", label: "人件費率", unit: "%", ...pick("personnelRatio"), higherIsBetter: false, guide: "業種で違う(飲食 30%前後・サービス業 40〜50%)", good: null, explain: "給料・法定福利費が売上の何%か。高すぎると利益が残りにくくなります。" },
    { key: "currentRatio", group: "安全性", label: "流動比率", unit: "%", ...pick("currentRatio"), higherIsBetter: true, guide: "120%以上が目安、200%以上なら安心", good: (v) => v >= 120, explain: "1年以内に払う負債に対して、1年以内に現金になる資産がどれだけあるか。" },
    { key: "quickRatio", group: "安全性", label: "当座比率", unit: "%", ...pick("quickRatio"), higherIsBetter: true, guide: "100%以上が目安", good: (v) => v >= 100, explain: "在庫を除いた、すぐ払いに使えるお金(現預金+売掛金)で、短期の負債をまかなえるか。" },
    { key: "equityRatio", group: "安全性", label: "自己資本比率", unit: "%", ...pick("equityRatio"), higherIsBetter: true, guide: "30%以上が目安、40%以上なら良好", good: (v) => v >= 30, explain: "資産のうち、返す必要のないお金(資本金+利益の蓄積)の割合。高いほど倒れにくい会社です。" },
    { key: "cashMonths", group: "安全性", label: "手元資金(月商の何か月分)", unit: "か月", ...pick("cashMonths"), higherIsBetter: true, guide: "1か月以上、できれば3か月分", good: (v) => v >= 1, explain: "現預金が月の売上の何か月分あるか。売上が止まっても払いを続けられる期間の目安です。" },
    { key: "receivableDays", group: "効率性", label: "売掛金の回収日数", unit: "日", ...pick("receivableDays"), higherIsBetter: false, guide: "取引条件(月末締め翌月末払いなら60日以内)", good: (v) => v <= 60, explain: "売上が入金されるまでに平均何日かかっているか。長いほど資金繰りが苦しくなります。" },
  ];
  return { from, to, priorFrom, priorTo, hasPrior, figures: cur, prior: hasPrior ? pri : null, metrics: list };
}
