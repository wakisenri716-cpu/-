import { jstDateKey } from "@/lib/jst";
import { getMonthlyTable } from "./monthly";

// 予算の進み具合(予実管理)。年間予算に対して、経過した月数分の予算・実績・このままのペースの着地見込みを出し、
// 費用は「超えた」「超えそう」、売上は「達成」「届かなそう」を判定する(予算は1年を均等に使う前提)。

export type ProgressStatus = "OVER" | "RISK" | "OK" | "ACHIEVED" | "BEHIND" | "NONE";

export async function getBudgetProgress(companyId: string, fiscalYear?: string | null, today = jstDateKey(new Date())) {
  const t = await getMonthlyTable(companyId, fiscalYear);
  const thisMonth = today.slice(0, 7);
  // 経過した月数(今月を含む)。過ぎた年度は12、これからの年度は0
  const elapsed = thisMonth > t.months[11] ? 12 : thisMonth < t.months[0] ? 0 : t.months.indexOf(thisMonth) + 1;

  const rowOf = (r: { accountId: string; code: string; name: string; months: number[]; total: number; budget: number | null }, kind: "REVENUE" | "EXPENSE") => {
    const actual = r.months.slice(0, elapsed || 12).reduce((s, v) => s + v, 0);
    const budget = r.budget;
    const pace = budget === null ? null : Math.round((budget * elapsed) / 12);
    const forecast = elapsed > 0 ? Math.round((actual / elapsed) * 12) : null;
    let status: ProgressStatus = "NONE";
    if (budget !== null && elapsed > 0) {
      if (kind === "EXPENSE") status = actual > budget ? "OVER" : forecast !== null && forecast > budget ? "RISK" : "OK";
      else status = actual >= budget ? "ACHIEVED" : forecast !== null && forecast < budget * 0.95 ? "BEHIND" : "OK";
    }
    return { accountId: r.accountId, code: r.code, name: r.name, kind, budget, pace, actual, forecast, rate: budget ? actual / budget : null, status };
  };

  const revenue = t.revenue.filter((r) => r.budget !== null).map((r) => rowOf(r, "REVENUE"));
  const expense = t.expense.filter((r) => r.budget !== null).map((r) => rowOf(r, "EXPENSE"));
  // 予算のない科目の実績(参考)
  const unbudgeted = [...t.revenue, ...t.expense].filter((r) => r.budget === null && r.total !== 0).length;
  const total = (rows: ReturnType<typeof rowOf>[]) => ({
    budget: rows.reduce((s, r) => s + (r.budget ?? 0), 0),
    pace: rows.reduce((s, r) => s + (r.pace ?? 0), 0),
    actual: rows.reduce((s, r) => s + r.actual, 0),
    forecast: rows.reduce((s, r) => s + (r.forecast ?? 0), 0),
  });
  return {
    year: t.year,
    current: t.current,
    months: t.months,
    elapsed,
    revenue,
    expense,
    revenueTotal: total(revenue),
    expenseTotal: total(expense),
    unbudgeted,
    alerts: expense.filter((r) => r.status === "OVER" || r.status === "RISK").length + revenue.filter((r) => r.status === "BEHIND").length,
  };
}

// ダッシュボードのやること: 今期の費用の超過・超過見込みと、売上の未達見込みの科目数
export async function countBudgetAlerts(companyId: string, now = new Date()) {
  const p = await getBudgetProgress(companyId, null, jstDateKey(now));
  return p.elapsed > 0 ? p.alerts : 0;
}
