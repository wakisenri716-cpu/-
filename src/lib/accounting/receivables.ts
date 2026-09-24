import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";

const OPEN_STATUSES = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

export const BUCKETS = [
  { key: "notDue", label: "期日前" },
  { key: "d30", label: "1〜30日超過" },
  { key: "d60", label: "31〜60日超過" },
  { key: "d90", label: "61日以上超過" },
] as const;
export type BucketKey = (typeof BUCKETS)[number]["key"];

function bucketOf(overdueDays: number): BucketKey {
  if (overdueDays <= 0) return "notDue";
  if (overdueDays <= 30) return "d30";
  if (overdueDays <= 60) return "d60";
  return "d90";
}

function emptyBuckets(): Record<BucketKey, number> {
  return { notDue: 0, d30: 0, d60: 0, d90: 0 };
}

// 未回収の売掛金(ISSUED)・未払いの買掛金(RECEIVED)を、請求書ごと・取引先ごとに期日の超過日数で分ける(年齢表)
export async function getAging(companyId: string, direction: "ISSUED" | "RECEIVED", today = jstDateKey(new Date())) {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction, status: { in: [...OPEN_STATUSES] } },
    include: { customer: { select: { name: true } }, vendor: { select: { name: true } }, payments: { select: { amount: true } } },
    orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }],
  });
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  const rows = invoices
    .map((inv) => {
      const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
      const overdueDays = inv.dueDate ? Math.round((todayMs - inv.dueDate.getTime()) / 86_400_000) : 0;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        partyName: (direction === "ISSUED" ? inv.customer?.name : inv.vendor?.name) ?? "(取引先不明)",
        issueDate: inv.issueDate ? inv.issueDate.toISOString().slice(0, 10) : null,
        dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
        total: inv.totalAmount,
        remaining,
        overdueDays: Math.max(0, overdueDays),
        bucket: bucketOf(overdueDays),
      };
    })
    .filter((r) => r.remaining > 0);

  const parties = new Map<string, { name: string; total: number; buckets: Record<BucketKey, number>; count: number }>();
  for (const r of rows) {
    const p = parties.get(r.partyName) ?? { name: r.partyName, total: 0, buckets: emptyBuckets(), count: 0 };
    p.total += r.remaining;
    p.buckets[r.bucket] += r.remaining;
    p.count += 1;
    parties.set(r.partyName, p);
  }
  const totals = emptyBuckets();
  for (const r of rows) totals[r.bucket] += r.remaining;

  return {
    today,
    rows,
    parties: [...parties.values()].sort((a, b) => b.total - a.total),
    totals,
    total: rows.reduce((s, r) => s + r.remaining, 0),
  };
}
