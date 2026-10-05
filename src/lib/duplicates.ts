import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 二重計上のチェック。経費精算の明細と受け取った請求書から、同じものを2回記帳していそうな組み合わせを探す。
// ・同じ画像(レシート・請求書のファイルの SHA-256 が同じ)… 高
// ・同じ取引先の同じ請求書番号 … 高
// ・同じ日・同じ金額・同じ取引先(経費どうし、請求書どうし、経費と請求書) … 中
// ・同じ日・同じ金額(取引先が分からない・違う)… 低(1,000円以上だけ)
// 「重複ではない」にした組み合わせは出さない。

const DAYS = 365;
const LOW_MIN = 1_000;
export type Level = "HIGH" | "MEDIUM" | "LOW";

type Rec = { kind: "EXPENSE" | "INVOICE"; id: string; date: string; amount: number; vendorId: string | null; vendorName: string | null; label: string; who: string | null; sha: string | null; invoiceNumber: string | null };

const norm = (s: string | null) => (s ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

async function records(companyId: string, since: Date): Promise<Rec[]> {
  const [items, invoices] = await Promise.all([
    prisma.expenseItem.findMany({
      where: { expenseReport: { companyId }, expenseDate: { gte: since } },
      select: { id: true, description: true, amount: true, expenseDate: true, receiptSha256: true, vendor: { select: { id: true, name: true } }, expenseReport: { select: { employee: { select: { name: true } } } } },
    }),
    prisma.invoice.findMany({
      where: { companyId, direction: "RECEIVED", status: { notIn: ["CANCELLED", "DRAFT"] }, OR: [{ issueDate: { gte: since } }, { issueDate: null, createdAt: { gte: since } }] },
      select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, createdAt: true, sourceSha256: true, vendor: { select: { id: true, name: true } } },
    }),
  ]);
  return [
    ...items.map((i) => ({
      kind: "EXPENSE" as const,
      id: i.id,
      date: jstDateKey(i.expenseDate),
      amount: i.amount,
      vendorId: i.vendor?.id ?? null,
      vendorName: i.vendor?.name ?? null,
      label: i.description,
      who: i.expenseReport.employee.name,
      sha: i.receiptSha256,
      invoiceNumber: null,
    })),
    ...invoices.map((i) => ({
      kind: "INVOICE" as const,
      id: i.id,
      date: jstDateKey(i.issueDate ?? i.createdAt),
      amount: i.totalAmount,
      vendorId: i.vendor?.id ?? null,
      vendorName: i.vendor?.name ?? null,
      label: `受け取った請求書${i.invoiceNumber ? ` ${i.invoiceNumber}` : ""}`,
      who: null,
      sha: i.sourceSha256,
      invoiceNumber: i.invoiceNumber,
    })),
  ];
}

const keyOf = (ids: string[]) => [...ids].sort().join(",");

export async function findDuplicates(companyId: string, now = new Date()) {
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const [recs, dismissed] = await Promise.all([records(companyId, since), prisma.duplicateDismissal.findMany({ where: { companyId }, select: { key: true } })]);
  const skip = new Set(dismissed.map((d) => d.key));
  const groups = new Map<string, { key: string; level: Level; reason: string; items: Rec[] }>();
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const add = (list: Rec[], level: Level, reason: string) => {
    if (list.length < 2) return;
    const key = keyOf(list.map((r) => r.id));
    if (skip.has(key)) return;
    const cur = groups.get(key);
    if (!cur || rank[level] > rank[cur.level]) groups.set(key, { key, level, reason, items: list });
  };
  const bucket = (f: (r: Rec) => string | null) => {
    const m = new Map<string, Rec[]>();
    for (const r of recs) {
      const k = f(r);
      if (k) m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()];
  };

  for (const list of bucket((r) => r.sha)) add(list, "HIGH", "同じ画像のレシート・請求書です");
  for (const list of bucket((r) => (r.kind === "INVOICE" && r.invoiceNumber && r.vendorId ? `${r.vendorId}|${norm(r.invoiceNumber)}` : null))) add(list, "HIGH", "同じ取引先の同じ請求書番号です");
  for (const list of bucket((r) => `${r.date}|${r.amount}`)) {
    if (list.length < 2 || list[0].amount <= 0) continue;
    // 取引先が同じもの(または摘要が同じもの)どうし
    const byVendor = new Map<string, Rec[]>();
    for (const r of list) {
      const k = r.vendorId ?? (r.kind === "EXPENSE" ? `d:${norm(r.label)}` : null);
      if (k) byVendor.set(k, [...(byVendor.get(k) ?? []), r]);
    }
    let found = false;
    for (const same of byVendor.values()) {
      if (same.length >= 2) {
        add(same, "MEDIUM", same.some((r) => r.kind === "EXPENSE") && same.some((r) => r.kind === "INVOICE") ? "同じ日・同じ金額・同じ取引先の経費と請求書です(立替と請求書払いの二重かもしれません)" : "同じ日・同じ金額・同じ取引先です");
        found = true;
      }
    }
    if (!found && list[0].amount >= LOW_MIN) add(list, "LOW", "同じ日・同じ金額です(取引先は違うか分かりません)");
  }

  const result = [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)), date: g.items[0].date, amount: g.items[0].amount }))
    .sort((a, b) => rank[b.level] - rank[a.level] || b.date.localeCompare(a.date));
  return { groups: result, dismissedCount: dismissed.length, days: DAYS };
}

export async function dismissDuplicate(companyId: string, user: { name: string }, ids: unknown) {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  if (list.length < 2) throw new UserError("組み合わせが正しくありません");
  const key = keyOf(list);
  await prisma.duplicateDismissal.upsert({ where: { companyId_key: { companyId, key } }, create: { companyId, key, byName: user.name }, update: {} });
  return { key };
}

// やること: 高・中の候補の数
export async function countDuplicates(companyId: string, now = new Date()) {
  const { groups } = await findDuplicates(companyId, now);
  return groups.filter((g) => g.level !== "LOW").length;
}
