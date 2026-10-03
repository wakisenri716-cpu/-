import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 与信管理: 顧客ごとに売掛金の上限(与信限度額)を決め、未回収の売掛金がどれだけ使っているかを見る。
// 請求書を作るときに上限を超えそうなら知らせる(止めはしない)。

const OPEN_STATUSES = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
// 上限のこの割合を超えたら「上限が近い」
export const NEAR_RATIO = 0.8;
// 最後の見直しからこの日数がたったら「見直しの時期」
export const REVIEW_DAYS = 365;

export type CreditStatus = "over" | "overdue" | "near" | "ok" | "none";
export const STATUS_LABEL: Record<CreditStatus, string> = {
  over: "上限を超えている",
  overdue: "期日を過ぎた売掛金あり",
  near: "上限が近い",
  ok: "問題なし",
  none: "上限なし",
};

// 顧客ごとの未回収の売掛金と、期日を過ぎた分
async function balances(companyId: string, today: string) {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction: "ISSUED", status: { in: [...OPEN_STATUSES] }, customerId: { not: null } },
    select: { customerId: true, totalAmount: true, dueDate: true, payments: { select: { amount: true } } },
  });
  const map = new Map<string, { balance: number; overdue: number; count: number }>();
  for (const inv of invoices) {
    const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
    if (remaining <= 0) continue;
    const row = map.get(inv.customerId!) ?? { balance: 0, overdue: 0, count: 0 };
    row.balance += remaining;
    row.count++;
    if (inv.dueDate && jstDateKey(inv.dueDate) < today) row.overdue += remaining;
    map.set(inv.customerId!, row);
  }
  return map;
}

function statusOf(limit: number | null, balance: number, overdue: number): CreditStatus {
  if (limit !== null && balance > limit) return "over";
  if (overdue > 0) return "overdue";
  if (limit === null) return "none";
  if (balance >= limit * NEAR_RATIO) return "near";
  return "ok";
}

export async function listCredit(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const [customers, map] = await Promise.all([prisma.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } }), balances(companyId, today)]);
  const reviewBefore = new Date(Date.parse(`${today}T00:00:00Z`) - REVIEW_DAYS * 86_400_000);
  const rows = customers
    .map((c) => {
      const b = map.get(c.id) ?? { balance: 0, overdue: 0, count: 0 };
      return {
        id: c.id,
        name: c.name,
        limit: c.creditLimit,
        balance: b.balance,
        overdue: b.overdue,
        invoiceCount: b.count,
        available: c.creditLimit === null ? null : c.creditLimit - b.balance,
        usage: c.creditLimit ? Math.round((b.balance / c.creditLimit) * 1000) / 10 : null,
        status: statusOf(c.creditLimit, b.balance, b.overdue),
        reviewedAt: c.creditReviewedAt ? jstDateKey(c.creditReviewedAt) : null,
        // 上限を決めているのに、1年以上見直していない
        reviewDue: c.creditLimit !== null && (!c.creditReviewedAt || c.creditReviewedAt < reviewBefore),
        note: c.creditNote,
      };
    })
    // 上限を決めた顧客と、売掛金が残っている顧客だけ
    .filter((r) => r.limit !== null || r.balance > 0);
  const order: Record<CreditStatus, number> = { over: 0, overdue: 1, near: 2, none: 3, ok: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.balance - a.balance);
  return {
    today,
    rows,
    customers: customers.map((c) => ({ id: c.id, name: c.name, limit: c.creditLimit })),
    summary: {
      balance: rows.reduce((s, r) => s + r.balance, 0),
      overdue: rows.reduce((s, r) => s + r.overdue, 0),
      over: rows.filter((r) => r.status === "over").length,
      near: rows.filter((r) => r.status === "near").length,
      noLimit: rows.filter((r) => r.limit === null && r.balance > 0).length,
      reviewDue: rows.filter((r) => r.reviewDue).length,
    },
  };
}

export async function updateCredit(companyId: string, customerId: string, input: { creditLimit?: unknown; creditReviewedAt?: unknown; creditNote?: unknown }) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!customer) throw new UserError("顧客が見つかりません");
  const raw = String(input.creditLimit ?? "").replaceAll(",", "").trim();
  const creditLimit = raw === "" ? null : Number(raw);
  if (creditLimit !== null && (!Number.isInteger(creditLimit) || creditLimit < 0 || creditLimit > 100_000_000_000)) throw new UserError("与信限度額は0円以上の整数で入力してください(空にすると上限なし)");
  const reviewed = String(input.creditReviewedAt ?? "").trim();
  if (reviewed && (!/^\d{4}-\d{2}-\d{2}$/.test(reviewed) || Number.isNaN(Date.parse(`${reviewed}T00:00:00Z`)))) throw new UserError("見直した日を正しく入力してください");
  const note = String(input.creditNote ?? "").trim();
  if (note.length > 500) throw new UserError("メモは500文字以内で入力してください");
  return prisma.customer.update({
    where: { id: customerId },
    data: { creditLimit, creditReviewedAt: reviewed ? new Date(`${reviewed}T00:00:00Z`) : creditLimit === null ? null : new Date(`${jstDateKey(new Date())}T00:00:00Z`), creditNote: note || null },
  });
}

// 請求書を作る前の確認: この顧客にこの金額を足すと上限を超えるか
export async function checkCredit(companyId: string, customerName: string, amount: number, now = new Date()) {
  const name = customerName.trim();
  if (!name) return null;
  const customer = await prisma.customer.findFirst({ where: { companyId, name } });
  if (!customer) return null;
  const b = (await balances(companyId, jstDateKey(now))).get(customer.id) ?? { balance: 0, overdue: 0, count: 0 };
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  const after = b.balance + add;
  return {
    customerId: customer.id,
    limit: customer.creditLimit,
    balance: b.balance,
    overdue: b.overdue,
    after,
    over: customer.creditLimit !== null && after > customer.creditLimit,
  };
}

// やることリスト用: 上限を超えている顧客の数
export async function countOverLimit(companyId: string, now = new Date()) {
  const customers = await prisma.customer.findMany({ where: { companyId, creditLimit: { not: null } }, select: { id: true, creditLimit: true } });
  if (!customers.length) return 0;
  const map = await balances(companyId, jstDateKey(now));
  return customers.filter((c) => (map.get(c.id)?.balance ?? 0) > c.creditLimit!).length;
}
