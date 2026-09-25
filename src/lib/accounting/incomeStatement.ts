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

// 1年前の同じ日(2/29 は 2/28 にする)
export function lastYear(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export type ComparisonRow = { accountId: string; code: string; name: string; current: number; prior: number };

// 当期と前年同期を科目ごとに並べる。期間の始まりか終わりが決まっていない(すべての期間)ときは比較しない。
export async function getIncomeStatementComparison(companyId: string, period: { from: string | null; to: string | null }) {
  const toRange = (from: string, to: string): DateRange => ({ gte: new Date(`${from}T00:00:00Z`), lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000) });
  if (!period.from || !period.to) return null;
  const priorPeriod = { from: lastYear(period.from), to: lastYear(period.to) };
  const [current, prior] = await Promise.all([
    getIncomeStatement(companyId, toRange(period.from, period.to)),
    getIncomeStatement(companyId, toRange(priorPeriod.from, priorPeriod.to)),
  ]);
  const merge = (cur: typeof current.revenueRows, pri: typeof prior.revenueRows): ComparisonRow[] => {
    const map = new Map<string, ComparisonRow>();
    for (const r of cur) map.set(r.account.id, { accountId: r.account.id, code: r.account.code, name: r.account.name, current: r.balance, prior: 0 });
    for (const r of pri) {
      const row = map.get(r.account.id) ?? { accountId: r.account.id, code: r.account.code, name: r.account.name, current: 0, prior: 0 };
      row.prior = r.balance;
      map.set(r.account.id, row);
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  };
  return {
    priorPeriod,
    revenue: merge(current.revenueRows, prior.revenueRows),
    expense: merge(current.expenseRows, prior.expenseRows),
    totals: {
      revenue: { current: current.totalRevenue, prior: prior.totalRevenue },
      expense: { current: current.totalExpense, prior: prior.totalExpense },
      net: { current: current.netIncome, prior: prior.netIncome },
    },
  };
}
