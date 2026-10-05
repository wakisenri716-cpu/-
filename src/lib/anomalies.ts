import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// 異常検知: 過去6か月のいつもの動きと比べて、気をつけたいお金の動きを見つける。
// ・費用の急増(いつもの1.5倍以上・3万円以上の差)/ ほとんど使っていなかった科目に大きな費用
// ・売上の急減(いつもの70%未満。終わった月で判定)
// ・いつもより大きい支払い(同じ科目の過去最大の3倍以上・5万円以上)
// ・初めての取引先への大きな支払い(10万円以上)
// 「確認した」にした項目は出さない。

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const HISTORY = 6;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type AnomalyType = "EXPENSE_SPIKE" | "NEW_SPEND" | "REVENUE_DROP" | "LARGE_PAYMENT" | "NEW_VENDOR";
export type Anomaly = { key: string; type: AnomalyType; level: "HIGH" | "MEDIUM"; title: string; detail: string; amount: number; href: string };

const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const start = (ym: string) => new Date(`${ym}-01T00:00:00Z`);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export async function findAnomalies(companyId: string, monthValue?: string | null, today = jstDateKey(new Date())) {
  const thisMonth = today.slice(0, 7);
  const month = monthValue && MONTH.test(monthValue) && monthValue <= thisMonth ? monthValue : thisMonth;
  // 売上は終わった月で比べる(今月はまだ途中なので前月)
  const revenueMonth = month < thisMonth ? month : shift(month, -1);
  const first = shift(revenueMonth < month ? revenueMonth : month, -HISTORY);
  const [lines, checks] = await Promise.all([
    prisma.journalLine.findMany({
      where: {
        account: { companyId, category: { in: ["REVENUE", "EXPENSE"] } },
        journalEntry: { companyId, status: { in: [...POSTED] }, date: { gte: start(first), lt: start(shift(month, 1)) } },
      },
      select: { debit: true, credit: true, account: { select: { id: true, name: true, category: true } }, journalEntry: { select: { id: true, date: true, description: true } } },
    }),
    prisma.anomalyCheck.findMany({ where: { companyId }, select: { key: true } }),
  ]);
  const checked = new Set(checks.map((c) => c.key));
  const found: Anomaly[] = [];
  const push = (a: Anomaly) => {
    if (!checked.has(a.key)) found.push(a);
  };

  // 科目×月の金額(費用は借方、売上は貸方を正)
  const byAccount = new Map<string, { name: string; category: string; months: Map<string, number> }>();
  for (const l of lines) {
    const m = jstDateKey(l.journalEntry.date).slice(0, 7);
    const a = byAccount.get(l.account.id) ?? { name: l.account.name, category: l.account.category, months: new Map() };
    const v = l.account.category === "EXPENSE" ? l.debit - l.credit : l.credit - l.debit;
    a.months.set(m, (a.months.get(m) ?? 0) + v);
    byAccount.set(l.account.id, a);
  }
  const history = (target: string) => Array.from({ length: HISTORY }, (_, i) => shift(target, -(i + 1)));

  for (const [id, a] of byAccount) {
    if (a.category !== "EXPENSE") continue;
    const now = a.months.get(month) ?? 0;
    const past = history(month).map((m) => a.months.get(m) ?? 0);
    const med = median(past);
    if (med <= 0 && now >= 50_000 && past.filter((v) => v > 0).length <= 1) {
      push({ key: `NEW_SPEND|${month}|${id}`, type: "NEW_SPEND", level: "MEDIUM", title: `${a.name}にいつもはない費用`, detail: `${month.replace("-", "年")}月に ${formatYen(now)}。過去6か月はほとんど使っていない科目です。`, amount: now, href: `/ledger?accountId=${id}` });
    } else if (med > 0 && now >= med * 1.5 && now - med >= 30_000) {
      const ratio = Math.round((now / med) * 10) / 10;
      push({ key: `EXPENSE_SPIKE|${month}|${id}`, type: "EXPENSE_SPIKE", level: ratio >= 3 ? "HIGH" : "MEDIUM", title: `${a.name}がいつもの${ratio}倍`, detail: `${month.replace("-", "年")}月は ${formatYen(now)}(いつもは月 ${formatYen(med)} くらい)。${month === thisMonth ? "今月はまだ途中です。" : ""}`, amount: now - med, href: `/ledger?accountId=${id}` });
    }
  }

  // 売上の急減
  const revenueNow = [...byAccount.values()].filter((a) => a.category === "REVENUE").reduce((s, a) => s + (a.months.get(revenueMonth) ?? 0), 0);
  const revenuePast = history(revenueMonth).map((m) => [...byAccount.values()].filter((a) => a.category === "REVENUE").reduce((s, a) => s + (a.months.get(m) ?? 0), 0));
  const revenueMed = median(revenuePast);
  if (revenueMed >= 100_000 && revenueNow < revenueMed * 0.7) {
    push({
      key: `REVENUE_DROP|${revenueMonth}`,
      type: "REVENUE_DROP",
      level: revenueNow < revenueMed * 0.5 ? "HIGH" : "MEDIUM",
      title: `${Number(revenueMonth.slice(5))}月の売上がいつもより少ない`,
      detail: `${formatYen(revenueNow)}(いつもは月 ${formatYen(revenueMed)} くらい、${Math.round((revenueNow / revenueMed) * 100)}%)。`,
      amount: revenueMed - revenueNow,
      href: "/sales-analysis",
    });
  }

  // いつもより大きい支払い(1回の仕訳の行で比べる)
  const maxPast = new Map<string, number>();
  for (const l of lines) {
    if (l.account.category !== "EXPENSE" || jstDateKey(l.journalEntry.date).slice(0, 7) >= month) continue;
    maxPast.set(l.account.id, Math.max(maxPast.get(l.account.id) ?? 0, l.debit));
  }
  for (const l of lines) {
    if (l.account.category !== "EXPENSE" || jstDateKey(l.journalEntry.date).slice(0, 7) !== month) continue;
    const before = maxPast.get(l.account.id) ?? 0;
    if (before > 0 && l.debit >= 50_000 && l.debit >= before * 3) {
      push({
        key: `LARGE_PAYMENT|${l.journalEntry.id}|${l.account.id}`,
        type: "LARGE_PAYMENT",
        level: "HIGH",
        title: `いつもより大きい${l.account.name}`,
        detail: `${jstDateKey(l.journalEntry.date).replaceAll("-", "/")}「${l.journalEntry.description}」${formatYen(l.debit)}(これまでの1回の最大は ${formatYen(before)})。`,
        amount: l.debit,
        href: `/ledger?accountId=${l.account.id}`,
      });
    }
  }

  // 初めての取引先への大きな支払い(受け取った請求書・経費)
  const monthRange = { gte: start(month), lt: start(shift(month, 1)) };
  const [invoices, items] = await Promise.all([
    prisma.invoice.findMany({ where: { companyId, direction: "RECEIVED", status: { notIn: ["CANCELLED", "DRAFT"] }, vendorId: { not: null }, issueDate: monthRange, totalAmount: { gte: 100_000 } }, select: { vendorId: true, totalAmount: true, vendor: { select: { name: true } } } }),
    prisma.expenseItem.findMany({ where: { expenseReport: { companyId }, vendorId: { not: null }, expenseDate: monthRange, amount: { gte: 100_000 } }, select: { vendorId: true, amount: true, vendor: { select: { name: true } } } }),
  ]);
  const candidates = new Map<string, { name: string; amount: number }>();
  for (const r of [...invoices.map((i) => ({ vendorId: i.vendorId!, name: i.vendor?.name ?? "", amount: i.totalAmount })), ...items.map((i) => ({ vendorId: i.vendorId!, name: i.vendor?.name ?? "", amount: i.amount }))]) {
    const c = candidates.get(r.vendorId) ?? { name: r.name, amount: 0 };
    c.amount += r.amount;
    candidates.set(r.vendorId, c);
  }
  for (const [vendorId, c] of candidates) {
    const before = await prisma.invoice.count({ where: { companyId, vendorId, OR: [{ issueDate: { lt: start(month) } }, { issueDate: null, createdAt: { lt: start(month) } }] } });
    const beforeItems = before ? 1 : await prisma.expenseItem.count({ where: { vendorId, expenseReport: { companyId }, expenseDate: { lt: start(month) } } });
    if (before + beforeItems === 0) {
      push({ key: `NEW_VENDOR|${month}|${vendorId}`, type: "NEW_VENDOR", level: "MEDIUM", title: `初めての取引先「${c.name}」への大きな支払い`, detail: `${month.replace("-", "年")}月に ${formatYen(c.amount)}。請求書の内容と、振込先が正しいかを確かめてください。`, amount: c.amount, href: "/invoices?direction=RECEIVED" });
    }
  }

  found.sort((a, b) => (a.level === b.level ? b.amount - a.amount : a.level === "HIGH" ? -1 : 1));
  return { month, revenueMonth, anomalies: found, checkedCount: checks.length };
}

export async function checkAnomaly(companyId: string, user: { name: string }, key: unknown, note: unknown) {
  const k = String(key ?? "");
  if (!/^(EXPENSE_SPIKE|NEW_SPEND|REVENUE_DROP|LARGE_PAYMENT|NEW_VENDOR)\|/.test(k) || k.length > 200) throw new UserError("項目が正しくありません");
  await prisma.anomalyCheck.upsert({
    where: { companyId_key: { companyId, key: k } },
    create: { companyId, key: k, note: String(note ?? "").trim().slice(0, 200) || null, byName: user.name },
    update: {},
  });
  return { key: k };
}

export async function countAnomalies(companyId: string, now = new Date()) {
  const { anomalies } = await findAnomalies(companyId, null, jstDateKey(now));
  return anomalies.length;
}
