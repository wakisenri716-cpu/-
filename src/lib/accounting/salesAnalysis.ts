import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { lastYear } from "./incomeStatement";
import { nextDay } from "./period";

// 売上分析: 発行した請求書(取消・下書きを除く)と POSレジの売上を税抜で集計する。
// ・顧客別(ABC分析: 売上の多い順に累計70%までをA、90%までをB、残りをC)
// ・品目別(請求書の明細の品目ごと)
// ・月別の推移
// いずれも前年の同じ期間と比べる(期間が決まっているとき)。

const COUNTED = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
export const POS_LABEL = "店頭売上(POSレジ)";

type Range = { from: string | null; to: string | null };
type Sale = { customer: string; date: string; amount: number };

async function salesIn(companyId: string, range: Range) {
  const date = { ...(range.from ? { gte: new Date(`${range.from}T00:00:00Z`) } : {}), ...(range.to ? { lt: nextDay(range.to) } : {}) };
  const [invoices, pos] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, direction: "ISSUED", status: { in: [...COUNTED] }, ...(range.from || range.to ? { issueDate: date } : {}) },
      select: { issueDate: true, subtotalAmount: true, customer: { select: { name: true } }, lines: { select: { description: true, quantity: true, amount: true } } },
    }),
    prisma.posSale.findMany({ where: { companyId, ...(range.from || range.to ? { soldAt: date } : {}) }, select: { soldAt: true, businessDate: true, totalAmount: true, taxAmount: true } }),
  ]);
  const sales: Sale[] = [
    ...invoices.map((i) => ({ customer: i.customer?.name ?? "(顧客なし)", date: i.issueDate ? jstDateKey(i.issueDate) : "", amount: i.subtotalAmount })),
    ...pos.map((p) => ({ customer: POS_LABEL, date: p.businessDate || jstDateKey(p.soldAt), amount: p.totalAmount - p.taxAmount })),
  ];
  const items = new Map<string, { amount: number; quantity: number; count: number }>();
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const key = l.description.normalize("NFKC").trim().replace(/\s+/g, " ") || "(品目なし)";
      const it = items.get(key) ?? { amount: 0, quantity: 0, count: 0 };
      it.amount += l.amount;
      it.quantity += l.quantity;
      it.count += 1;
      items.set(key, it);
    }
  }
  return { sales, items, invoiceCount: invoices.length };
}

const sumBy = (sales: Sale[], key: (s: Sale) => string) => {
  const map = new Map<string, { amount: number; count: number }>();
  for (const s of sales) {
    const k = key(s);
    const v = map.get(k) ?? { amount: 0, count: 0 };
    v.amount += s.amount;
    v.count += 1;
    map.set(k, v);
  }
  return map;
};

export async function getSalesAnalysis(companyId: string, period: Range) {
  const priorRange = period.from && period.to ? { from: lastYear(period.from), to: lastYear(period.to) } : null;
  const [cur, prior] = await Promise.all([salesIn(companyId, period), priorRange ? salesIn(companyId, priorRange) : Promise.resolve(null)]);
  const total = cur.sales.reduce((s, x) => s + x.amount, 0);
  const priorTotal = prior ? prior.sales.reduce((s, x) => s + x.amount, 0) : null;

  // 顧客別とABC分析
  const byCustomer = sumBy(cur.sales, (s) => s.customer);
  const priorByCustomer = prior ? sumBy(prior.sales, (s) => s.customer) : null;
  let cumulative = 0;
  const customers = [...byCustomer.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([name, v]) => {
      cumulative += v.amount;
      const cumShare = total > 0 ? cumulative / total : 0;
      const before = total > 0 ? (cumulative - v.amount) / total : 0;
      // 累計の割合が70%に届くまでの顧客がA(その顧客で70%を超える場合もA)、90%までがB
      const rank = before < 0.7 ? "A" : before < 0.9 ? "B" : "C";
      return { name, amount: v.amount, count: v.count, share: total > 0 ? v.amount / total : 0, cumShare, rank, prior: priorByCustomer ? (priorByCustomer.get(name)?.amount ?? 0) : null };
    });
  // 前の期間だけにあった顧客(売上がなくなった顧客)
  const lost = priorByCustomer ? [...priorByCustomer.entries()].filter(([name]) => !byCustomer.has(name)).sort((a, b) => b[1].amount - a[1].amount).map(([name, v]) => ({ name, prior: v.amount })) : [];
  const rankSummary = (["A", "B", "C"] as const).map((rank) => {
    const list = customers.filter((c) => c.rank === rank);
    return { rank, count: list.length, amount: list.reduce((s, c) => s + c.amount, 0) };
  });

  // 品目別
  const itemTotal = [...cur.items.values()].reduce((s, v) => s + v.amount, 0);
  const items = [...cur.items.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 100)
    .map(([name, v]) => ({ name, amount: v.amount, quantity: Math.round(v.quantity * 100) / 100, count: v.count, share: itemTotal > 0 ? v.amount / itemTotal : 0, prior: prior ? (prior.items.get(name)?.amount ?? 0) : null }));

  // 月別(期間の月をすべて並べる。期間が決まっていなければ売上のある月だけ)
  const byMonth = sumBy(cur.sales, (s) => s.date.slice(0, 7));
  const priorByMonth = prior ? sumBy(prior.sales, (s) => s.date.slice(0, 7)) : null;
  let months: string[] = [...byMonth.keys()].filter(Boolean).sort();
  if (period.from && period.to) {
    months = [];
    for (let m = period.from.slice(0, 7); m <= period.to.slice(0, 7) && months.length < 60; ) {
      months.push(m);
      const [y, mo] = m.split("-").map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
  }
  const monthly = months.map((m) => {
    const p = lastYear(`${m}-01`).slice(0, 7);
    return { month: m, amount: byMonth.get(m)?.amount ?? 0, prior: priorByMonth ? (priorByMonth.get(p)?.amount ?? 0) : null };
  });

  return { total, priorTotal, priorRange, invoiceCount: cur.invoiceCount, customers, lost, rankSummary, items, monthly };
}

export type SalesAnalysis = Awaited<ReturnType<typeof getSalesAnalysis>>;

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function salesAnalysisCsv(a: SalesAnalysis): (string | number)[][] {
  const rows: (string | number)[][] = [["区分", "名前", "売上(税抜)", "構成比", "累計構成比", "ランク", "件数", "前年同期"]];
  for (const c of a.customers) rows.push(["顧客別", c.name, c.amount, pct(c.share), pct(c.cumShare), c.rank, c.count, c.prior ?? ""]);
  for (const i of a.items) rows.push(["品目別", i.name, i.amount, pct(i.share), "", "", i.count, i.prior ?? ""]);
  for (const m of a.monthly) rows.push(["月別", m.month, m.amount, "", "", "", "", m.prior ?? ""]);
  return rows;
}
