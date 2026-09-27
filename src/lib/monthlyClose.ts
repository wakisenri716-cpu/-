import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { getFixedAssetsWithSummary } from "@/lib/accounting/fixedAssets";
import { listRecurring } from "@/lib/accounting/recurring";
import { listRecurringInvoices } from "@/lib/accounting/recurringInvoices";
import { getReimbursements } from "@/lib/accounting/reimbursement";

// 月次決算チェックリスト: 月末の締めでやることを、データから済んだかどうか判定する項目と、
// 人が確かめてチェックを付ける項目に分けて並べる。

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const OPEN_INVOICE = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

export const DEFAULT_MANUAL_ITEMS = [
  { key: "cashBalance", label: "現金の残高を、手元の現金と合わせた" },
  { key: "bankBalance", label: "預金の残高を、通帳・ネットバンクの残高と合わせた" },
  { key: "cardStatements", label: "クレジットカードの利用明細を、すべて取り込んだ" },
  { key: "receiptsFiled", label: "今月の領収書・請求書を、すべて登録した" },
  { key: "trialBalance", label: "試算表・損益計算書を見て、おかしな金額がないか確かめた" },
];

export type CheckItem = {
  key: string;
  label: string;
  kind: "auto" | "manual";
  done: boolean;
  // 自動の項目: 残っている件数などの説明と、片付ける画面
  detail?: string;
  href?: string;
  // 人の項目: 誰がいつチェックしたか
  checkedBy?: string | null;
  checkedAt?: string | null;
  custom?: boolean;
};

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(value: unknown, today = jstDateKey(new Date())) {
  const month = String(value ?? "");
  if (!month) return addMonths(today.slice(0, 7), -1); // 既定は先月(締めるのは前の月)
  if (!MONTH.test(month)) throw new UserError("月を正しく指定してください");
  return month;
}

function customItems(value: unknown) {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function customKey(label: string) {
  return `custom:${label}`;
}

async function autoItems(companyId: string, month: string, today: string): Promise<CheckItem[]> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(`${addMonths(month, 1)}-01T00:00:00Z`);
  const range = { gte: start, lt: end };
  const monthEnd = new Date(end.getTime() - 86_400_000);
  const monthLabel = `${Number(month.slice(5))}月`;
  const [bank, reviews, recurring, recurringInvoices, assets, payroll, shifts, records, reimbursements, receivables, payables, orders, company] = await Promise.all([
    prisma.bankTransaction.count({ where: { companyId, status: "PENDING", date: range } }),
    prisma.journalEntry.count({ where: { companyId, status: "PENDING_REVIEW", date: range } }),
    listRecurring(companyId, today),
    listRecurringInvoices(companyId, today),
    getFixedAssetsWithSummary(companyId),
    prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } }, select: { id: true } }),
    prisma.shift.count({ where: { companyId, date: range } }),
    prisma.timeRecord.count({ where: { companyId, date: range } }),
    getReimbursements(companyId),
    prisma.invoice.count({ where: { companyId, direction: "ISSUED", status: { in: [...OPEN_INVOICE] }, dueDate: { lt: end } } }),
    prisma.invoice.count({ where: { companyId, direction: "RECEIVED", status: { in: [...OPEN_INVOICE] }, dueDate: { lt: end } } }),
    prisma.purchaseOrder.count({ where: { companyId, status: "OPEN", deliveryDate: { lt: end } } }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { booksClosedThrough: true } }),
  ]);
  const recurringLeft = recurring.filter((r) => r.due.includes(month)).length;
  const invoicesLeft = recurringInvoices.filter((r) => r.due.includes(month)).length;
  const depreciationLeft = assets.filter(
    (a) => !a.disposedAt && !a.fullyDepreciated && a.acquisitionDate.toISOString().slice(0, 7) <= month && !a.depreciationEntries.some((e) => e.period === month),
  ).length;
  const worked = shifts + records > 0;
  const reimburseLeft = reimbursements.filter((r) => r.state === "READY" || (r.state === "AWAITING_APPROVAL" && r.approvalStatus === "SUBMITTED")).length;
  const closed = company.booksClosedThrough ? jstDateKey(company.booksClosedThrough) >= jstDateKey(monthEnd) : false;
  const count = (n: number, unit = "件") => `${n}${unit}残っています`;

  return [
    { key: "bank", label: "銀行・カード明細の勘定科目を確定した", kind: "auto", done: bank === 0, detail: bank ? count(bank) : undefined, href: "/bank" },
    { key: "review", label: "AI仕訳のレビューを終えた", kind: "auto", done: reviews === 0, detail: reviews ? count(reviews) : undefined, href: "/review" },
    { key: "recurring", label: "家賃など毎月の取引を記帳した", kind: "auto", done: recurringLeft === 0, detail: recurringLeft ? count(recurringLeft) : undefined, href: "/recurring" },
    { key: "recurringInvoices", label: "毎月の定期請求を発行した", kind: "auto", done: invoicesLeft === 0, detail: invoicesLeft ? count(invoicesLeft) : undefined, href: "/recurring-invoices" },
    { key: "depreciation", label: `${monthLabel}分の減価償却を計上した`, kind: "auto", done: depreciationLeft === 0, detail: depreciationLeft ? count(depreciationLeft, "件の資産が") : undefined, href: "/assets" },
    {
      key: "payroll",
      label: `${monthLabel}分の給料を計上した`,
      kind: "auto",
      done: !worked || !!payroll,
      detail: worked && !payroll ? "シフト・勤怠がありますが、給料が未計上です" : !worked ? "この月の勤怠はありません" : undefined,
      href: "/payroll",
    },
    { key: "reimburse", label: "立替経費の承認・精算を終えた", kind: "auto", done: reimburseLeft === 0, detail: reimburseLeft ? count(reimburseLeft) : undefined, href: "/reimbursements" },
    { key: "orders", label: "納品された発注を検収した", kind: "auto", done: orders === 0, detail: orders ? `納期が${monthLabel}までの発注が${count(orders)}` : undefined, href: "/purchase-orders" },
    { key: "receivables", label: "期日が来た売掛金の入金を確かめた", kind: "auto", done: receivables === 0, detail: receivables ? `期日が${monthLabel}までで未入金の請求書が${count(receivables)}` : undefined, href: "/receivables" },
    { key: "payables", label: "期日が来た買掛金を支払った", kind: "auto", done: payables === 0, detail: payables ? `期日が${monthLabel}までで未払いの請求書が${count(payables)}` : undefined, href: "/receivables?type=payable" },
    { key: "closed", label: `${monthLabel}末まで帳簿を締めた`, kind: "auto", done: closed, detail: closed ? undefined : "ほかの項目が済んだら締めてください(締めた期間の仕訳は変更できなくなります)", href: "/closing" },
  ];
}

export async function getMonthlyClose(companyId: string, monthValue: unknown, today = jstDateKey(new Date())) {
  const month = parseMonth(monthValue, today);
  if (month > today.slice(0, 7)) throw new UserError("先の月は確かめられません");
  const [company, checks, auto] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { closeChecklist: true } }),
    prisma.monthlyCloseCheck.findMany({ where: { companyId, month } }),
    autoItems(companyId, month, today),
  ]);
  const checked = new Map(checks.map((c) => [c.key, c]));
  const manualDefs = [...DEFAULT_MANUAL_ITEMS.map((i) => ({ ...i, custom: false })), ...customItems(company.closeChecklist).map((label) => ({ key: customKey(label), label, custom: true }))];
  const manual: CheckItem[] = manualDefs.map((i) => {
    const c = checked.get(i.key);
    return { key: i.key, label: i.label, kind: "manual", done: !!c, checkedBy: c?.checkedBy ?? null, checkedAt: c ? c.checkedAt.toISOString() : null, custom: i.custom };
  });
  const items = [...auto, ...manual];
  return { month, prev: addMonths(month, -1), next: month < today.slice(0, 7) ? addMonths(month, 1) : null, items, done: items.filter((i) => i.done).length, total: items.length };
}

// 人が確かめる項目のチェックを付ける・外す
export async function setManualCheck(companyId: string, input: { month?: unknown; key?: unknown; done?: unknown }, userName: string, today = jstDateKey(new Date())) {
  const month = parseMonth(input.month, today);
  const key = String(input.key ?? "");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { closeChecklist: true } });
  const keys = new Set([...DEFAULT_MANUAL_ITEMS.map((i) => i.key), ...customItems(company.closeChecklist).map(customKey)]);
  if (!keys.has(key)) throw new UserError("チェックの項目が見つかりません");
  if (input.done) {
    await prisma.monthlyCloseCheck.upsert({
      where: { companyId_month_key: { companyId, month, key } },
      update: {},
      create: { companyId, month, key, checkedBy: userName },
    });
  } else {
    await prisma.monthlyCloseCheck.deleteMany({ where: { companyId, month, key } });
  }
  return { month, key };
}

// 会社で足す確認項目(例: 「在庫を数えた」)
export async function setCustomItems(companyId: string, value: unknown) {
  const items = (Array.isArray(value) ? value : [])
    .map((v) => String(v ?? "").normalize("NFKC").trim())
    .filter(Boolean);
  if (items.length > 20) throw new UserError("足せる項目は20個までです");
  if (items.some((i) => i.length > 60)) throw new UserError("項目は60文字以内にしてください");
  const unique = [...new Set(items)];
  await prisma.company.update({ where: { id: companyId }, data: { closeChecklist: unique } });
  return unique;
}

// ここ数か月の進み具合(一覧の上に出す)
export async function getRecentProgress(companyId: string, months = 6, today = jstDateKey(new Date())) {
  const current = addMonths(today.slice(0, 7), -1);
  const list = Array.from({ length: months }, (_, i) => addMonths(current, -i));
  return Promise.all(
    list.map(async (month) => {
      const data = await getMonthlyClose(companyId, month, today);
      return { month, done: data.done, total: data.total };
    }),
  );
}
