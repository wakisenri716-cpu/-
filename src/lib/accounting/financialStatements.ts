import { getAccountBalances } from "@/lib/accounting/ledger";
import { fiscalYearOf, getFiscalStartMonth, nextDay } from "./period";

// 決算報告書(表紙・貸借対照表・損益計算書・販売費及び一般管理費内訳書)。
// 区分は勘定科目コードで決める: 資産 1000〜1499 流動 / 1500〜 固定、負債 2000〜2199 流動 / 2200〜 固定。
// 期末の振替仕訳はしていないので、純資産の「繰越利益剰余金」には前期までの利益の累計を含めて表示する。

const COST_OF_SALES = "5000";
const ACCUMULATED_DEPRECIATION = "1519"; // 資産のマイナス(科目の区分上は負債に置いている)
const NON_OPERATING_REVENUE = new Set(["4020"]); // 雑収入
const EXTRAORDINARY_GAIN = new Set(["4030"]); // 固定資産売却益
const NON_OPERATING_EXPENSE = new Set(["5150"]); // 支払利息
const EXTRAORDINARY_LOSS = new Set(["5160"]); // 固定資産除売却損
const RETAINED_EARNINGS = "3020";

export type StatementRow = { code: string; name: string; amount: number };

type Balance = Awaited<ReturnType<typeof getAccountBalances>>[number];

const row = (b: Balance, amount = b.balance): StatementRow => ({ code: b.account.code, name: b.account.name, amount });
const sum = (rows: StatementRow[]) => rows.reduce((s, r) => s + r.amount, 0);
const nonZero = (rows: StatementRow[]) => rows.filter((r) => r.amount !== 0);

export async function getFinancialStatements(companyId: string, fiscalYear?: number, today?: string) {
  const startMonth = await getFiscalStartMonth(companyId);
  const current = fiscalYearOf(today ?? new Date().toISOString().slice(0, 10), startMonth);
  const year = fiscalYear ?? current.year;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const fy = fiscalYearOf(from, startMonth);

  const [period, cumulative, beforePeriod] = await Promise.all([
    getAccountBalances(companyId, { gte: new Date(`${fy.from}T00:00:00Z`), lt: nextDay(fy.to) }),
    getAccountBalances(companyId, { lt: nextDay(fy.to) }),
    getAccountBalances(companyId, { lt: new Date(`${fy.from}T00:00:00Z`) }),
  ]);

  // ---- 損益計算書(期中の動き)
  const pl = (pick: (b: Balance) => boolean) => nonZero(period.filter(pick).map((b) => row(b)));
  const sales = pl((b) => b.account.category === "REVENUE" && !NON_OPERATING_REVENUE.has(b.account.code) && !EXTRAORDINARY_GAIN.has(b.account.code));
  const costOfSales = pl((b) => b.account.code === COST_OF_SALES);
  const sga = pl(
    (b) => b.account.category === "EXPENSE" && b.account.code !== COST_OF_SALES && !NON_OPERATING_EXPENSE.has(b.account.code) && !EXTRAORDINARY_LOSS.has(b.account.code),
  );
  const nonOpRevenue = pl((b) => NON_OPERATING_REVENUE.has(b.account.code));
  const nonOpExpense = pl((b) => NON_OPERATING_EXPENSE.has(b.account.code));
  const extraGain = pl((b) => EXTRAORDINARY_GAIN.has(b.account.code));
  const extraLoss = pl((b) => EXTRAORDINARY_LOSS.has(b.account.code));
  const grossProfit = sum(sales) - sum(costOfSales);
  const operatingProfit = grossProfit - sum(sga);
  const ordinaryProfit = operatingProfit + sum(nonOpRevenue) - sum(nonOpExpense);
  const netIncome = ordinaryProfit + sum(extraGain) - sum(extraLoss);

  // ---- 貸借対照表(期末の残高)
  const code = (b: Balance) => Number(b.account.code);
  const bs = (pick: (b: Balance) => boolean) => nonZero(cumulative.filter(pick).map((b) => row(b)));
  const depreciation = cumulative.find((b) => b.account.code === ACCUMULATED_DEPRECIATION)?.balance ?? 0;
  const currentAssets = bs((b) => b.account.category === "ASSET" && code(b) < 1500);
  const fixedAssets = [
    ...bs((b) => b.account.category === "ASSET" && code(b) >= 1500),
    ...(depreciation ? [{ code: ACCUMULATED_DEPRECIATION, name: "減価償却累計額", amount: -depreciation }] : []),
  ];
  const currentLiabilities = bs((b) => b.account.category === "LIABILITY" && code(b) >= 2000 && code(b) < 2200);
  const fixedLiabilities = bs((b) => b.account.category === "LIABILITY" && code(b) >= 2200);

  // 純資産: 資本金など + 繰越利益剰余金(前期までの利益の累計を含む) + 当期純利益
  const incomeBefore = (list: Balance[]) =>
    list.filter((b) => b.account.category === "REVENUE").reduce((s, b) => s + b.balance, 0) - list.filter((b) => b.account.category === "EXPENSE").reduce((s, b) => s + b.balance, 0);
  const capital = bs((b) => b.account.category === "EQUITY" && b.account.code !== RETAINED_EARNINGS);
  const retainedAccount = cumulative.find((b) => b.account.code === RETAINED_EARNINGS)?.balance ?? 0;
  const retained = retainedAccount + incomeBefore(beforePeriod);
  const equity = [
    ...capital,
    ...(retained ? [{ code: RETAINED_EARNINGS, name: "繰越利益剰余金", amount: retained }] : []),
    { code: "", name: "当期純利益", amount: netIncome },
  ];

  const totalAssets = sum(currentAssets) + sum(fixedAssets);
  const totalLiabilities = sum(currentLiabilities) + sum(fixedLiabilities);
  const totalEquity = sum(equity);

  return {
    fiscalYear: year,
    currentYear: current.year,
    from: fy.from,
    to: fy.to,
    inProgress: fy.to >= (today ?? new Date().toISOString().slice(0, 10)),
    balanceSheet: {
      currentAssets,
      fixedAssets,
      currentLiabilities,
      fixedLiabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: totalAssets === totalLiabilities + totalEquity,
    },
    incomeStatement: {
      sales,
      costOfSales,
      sga,
      nonOpRevenue,
      nonOpExpense,
      extraGain,
      extraLoss,
      totals: {
        sales: sum(sales),
        costOfSales: sum(costOfSales),
        grossProfit,
        sga: sum(sga),
        operatingProfit,
        nonOpRevenue: sum(nonOpRevenue),
        nonOpExpense: sum(nonOpExpense),
        ordinaryProfit,
        extraGain: sum(extraGain),
        extraLoss: sum(extraLoss),
        netIncome,
      },
    },
  };
}
