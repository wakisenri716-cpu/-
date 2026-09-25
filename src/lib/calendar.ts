import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { postingDate } from "@/lib/accounting/recurring";

// 入金・支払カレンダー: 請求書の期日(入金予定・支払予定)、定期取引・定期請求の日、書類の期限を1か月分まとめる。

export type CalendarEventKind = "receive" | "pay" | "recurring" | "recurringInvoice" | "file";
export type CalendarEvent = {
  date: string;
  kind: CalendarEventKind;
  label: string;
  amount: number | null;
  href: string;
  overdue: boolean;
};

const OPEN_STATUSES = ["CONFIRMED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function resolveMonth(value: string | undefined, today = jstDateKey(new Date())) {
  return value && MONTH.test(value) ? value : today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export async function getCalendar(companyId: string, month: string, today = jstDateKey(new Date())) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`);
  const isCurrent = month === today.slice(0, 7);
  const [invoices, overdue, recurring, recurringInvoices, files] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, status: { in: [...OPEN_STATUSES] }, dueDate: { gte: start, lt: end } },
      include: { customer: { select: { name: true } }, vendor: { select: { name: true } }, payments: { select: { amount: true } } },
    }),
    // 今月の画面では、期日を過ぎたまま残っている請求書も今日の欄に出す
    isCurrent
      ? prisma.invoice.findMany({
          where: { companyId, status: { in: [...OPEN_STATUSES] }, dueDate: { lt: start } },
          include: { customer: { select: { name: true } }, vendor: { select: { name: true } }, payments: { select: { amount: true } } },
        })
      : Promise.resolve([]),
    prisma.recurringEntry.findMany({ where: { companyId, active: true }, include: { lines: { select: { debit: true } } } }),
    prisma.recurringInvoice.findMany({ where: { companyId, active: true }, include: { templateInvoice: { select: { totalAmount: true, customer: { select: { name: true } } } } } }),
    prisma.storedFile.findMany({ where: { companyId, expiresOn: { gte: start, lt: end } }, select: { id: true, name: true, expiresOn: true } }),
  ]);

  const events: CalendarEvent[] = [];
  const invoiceEvent = (inv: (typeof invoices)[number], date: string, late: boolean) => {
    const remaining = inv.totalAmount - inv.payments.reduce((s, p) => s + p.amount, 0);
    if (remaining <= 0) return;
    const receive = inv.direction === "ISSUED";
    const party = receive ? inv.customer?.name : inv.vendor?.name;
    events.push({
      date,
      kind: receive ? "receive" : "pay",
      label: `${party ?? "取引先未設定"}${inv.invoiceNumber ? `(${inv.invoiceNumber})` : ""}`,
      amount: remaining,
      // 期日を過ぎた入金は督促状の画面へ
      href: receive ? (late ? `/invoices/${inv.id}/reminder` : "/receivables") : "/receivables?type=payable",
      overdue: late,
    });
  };
  for (const inv of invoices) {
    const due = inv.dueDate!.toISOString().slice(0, 10);
    invoiceEvent(inv, due, due < today);
  }
  for (const inv of overdue) invoiceEvent(inv, today, true);

  const inRange = (r: { startMonth: string; endMonth: string | null }) => r.startMonth <= month && (!r.endMonth || r.endMonth >= month);
  for (const r of recurring.filter(inRange)) {
    events.push({ date: postingDate(month, r.dayOfMonth), kind: "recurring", label: r.name, amount: r.lines.reduce((s, l) => s + l.debit, 0), href: "/recurring", overdue: false });
  }
  for (const r of recurringInvoices.filter(inRange)) {
    events.push({
      date: postingDate(month, r.issueDay),
      kind: "recurringInvoice",
      label: `${r.name}${r.templateInvoice.customer ? `(${r.templateInvoice.customer.name})` : ""}`,
      amount: r.templateInvoice.totalAmount,
      href: "/recurring-invoices",
      overdue: false,
    });
  }
  for (const f of files) {
    const date = f.expiresOn!.toISOString().slice(0, 10);
    events.push({ date, kind: "file", label: f.name, amount: null, href: `/files/${f.id}`, overdue: date < today });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const total = (kind: CalendarEventKind) => events.filter((e) => e.kind === kind).reduce((s, e) => s + (e.amount ?? 0), 0);
  return { month, today, events, totals: { receive: total("receive"), pay: total("pay") } };
}
