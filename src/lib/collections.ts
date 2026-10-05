import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";

// 督促・回収: 支払期限を過ぎた発行済み請求書ごとに、遅れている日数・これまでの督促・その顧客のふだんの払い方から
// 「次にやること」(1回目の確認 → 2回目の督促 → 電話 → 専門家への相談)を決める。

const OPEN = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
const DAY = 86_400_000;

export type Stage = "WAIT" | "FIRST" | "SECOND" | "CALL" | "LEGAL";
export const STAGE_LABELS: Record<Stage, { label: string; action: string; className: string }> = {
  WAIT: { label: "返事待ち", action: "督促したばかりです。数日は返事・入金を待ちましょう", className: "bg-slate-100 text-slate-700" },
  FIRST: { label: "1回目", action: "やわらかく入金の確認をお願いするメールを送りましょう", className: "bg-sky-100 text-sky-800" },
  SECOND: { label: "2回目", action: "期限を示して、はっきり入金をお願いしましょう", className: "bg-amber-100 text-amber-800" },
  CALL: { label: "電話", action: "メールで返事がありません。電話で状況を確かめましょう", className: "bg-orange-100 text-orange-800" },
  LEGAL: { label: "要相談", action: "長く入金がありません。内容証明や専門家への相談を考えましょう", className: "bg-rose-100 text-rose-700" },
};

export function stageOf(daysOverdue: number, reminders: number, daysSinceLast: number | null): Stage {
  if (daysOverdue > 90) return "LEGAL";
  if (daysSinceLast !== null && daysSinceLast < 7) return "WAIT";
  if (reminders >= 2 || daysOverdue > 45) return "CALL";
  if (reminders === 1) return "SECOND";
  return "FIRST";
}

// その顧客の過去の払い方(入金済みの請求書で、期限から何日後に払い終えたか)
async function paymentHabits(companyId: string, customerIds: string[]) {
  const paid = await prisma.invoice.findMany({
    where: { companyId, direction: "ISSUED", status: "PAID", customerId: { in: customerIds }, dueDate: { not: null } },
    select: { customerId: true, dueDate: true, payments: { select: { paymentDate: true } } },
    orderBy: { dueDate: "desc" },
    take: 500,
  });
  const map = new Map<string, { paidCount: number; lateCount: number; avgLateDays: number }>();
  for (const id of customerIds) {
    const list = paid.filter((p) => p.customerId === id && p.payments.length).slice(0, 12);
    const lates = list.map((p) => Math.max(0, Math.round((Math.max(...p.payments.map((x) => x.paymentDate.getTime())) - p.dueDate!.getTime()) / DAY)));
    map.set(id, { paidCount: list.length, lateCount: lates.filter((d) => d > 0).length, avgLateDays: lates.length ? Math.round(lates.reduce((s, d) => s + d, 0) / lates.length) : 0 });
  }
  return map;
}

export async function getCollections(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction: "ISSUED", status: { in: [...OPEN] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } },
    include: { customer: { select: { id: true, name: true, email: true, phone: true } }, payments: { select: { amount: true } } },
    orderBy: { dueDate: "asc" },
  });
  const rows = invoices
    .map((inv) => ({ inv, remaining: inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0) }))
    .filter((r) => r.remaining > 0);
  const [logs, habits] = await Promise.all([
    prisma.emailLog.findMany({
      where: { companyId, kind: "REMINDER", status: { not: "FAILED" }, relatedId: { in: rows.map((r) => r.inv.id) } },
      select: { relatedId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    paymentHabits(companyId, [...new Set(rows.flatMap((r) => (r.inv.customerId ? [r.inv.customerId] : [])))]),
  ]);
  const list = rows.map(({ inv, remaining }) => {
    const sent = logs.filter((l) => l.relatedId === inv.id);
    const last = sent[0]?.createdAt ?? null;
    const daysOverdue = Math.round((todayMs - inv.dueDate!.getTime()) / DAY);
    const daysSinceLast = last ? Math.floor((now.getTime() - last.getTime()) / DAY) : null;
    const stage = stageOf(daysOverdue, sent.length, daysSinceLast);
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.customer,
      issueDate: inv.issueDate ? inv.issueDate.toISOString().slice(0, 10) : null,
      dueDate: inv.dueDate!.toISOString().slice(0, 10),
      total: inv.totalAmount,
      remaining,
      partiallyPaid: remaining < inv.totalAmount,
      daysOverdue,
      reminders: sent.length,
      lastReminded: last ? jstDateKey(last) : null,
      stage,
      habit: inv.customerId ? (habits.get(inv.customerId) ?? null) : null,
    };
  });
  // 段階が進んでいるもの・金額が大きいものから
  const order: Stage[] = ["LEGAL", "CALL", "SECOND", "FIRST", "WAIT"];
  list.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || b.remaining - a.remaining);
  return { rows: list, total: list.reduce((s, r) => s + r.remaining, 0) };
}

export type CollectionRow = Awaited<ReturnType<typeof getCollections>>["rows"][number];

export async function getCollectionRow(companyId: string, invoiceId: string) {
  const { rows } = await getCollections(companyId);
  return rows.find((r) => r.id === invoiceId) ?? null;
}
