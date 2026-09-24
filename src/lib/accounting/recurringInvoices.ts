import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { UserError } from "@/lib/errors";
import { cancelIssuedInvoice, issueInvoice } from "./issueInvoice";
import { postingDate } from "./recurring";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BACKFILL = 12;

export type RecurringInvoiceInput = {
  name: string;
  templateInvoiceId: string;
  issueDay: number;
  dueDays: number | null;
  startMonth: string;
  endMonth?: string | null;
};

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// 支払期限: 日数の指定があれば請求日からその日数後、なければ翌月末
function dueDateFor(issueDate: string, dueDays: number | null) {
  if (dueDays !== null) return new Date(Date.parse(`${issueDate}T00:00:00Z`) + dueDays * 86_400_000).toISOString().slice(0, 10);
  const [y, m] = issueDate.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

async function validate(companyId: string, input: RecurringInvoiceInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("名前を入力してください");
  if (!Number.isInteger(input.issueDay) || input.issueDay < 0 || input.issueDay > 28) throw new UserError("請求日は1〜28日、または月末を選んでください");
  if (input.dueDays !== null && (!Number.isInteger(input.dueDays) || input.dueDays < 0 || input.dueDays > 365)) {
    throw new UserError("支払期限の日数は0〜365で入力してください");
  }
  if (!MONTH.test(input.startMonth)) throw new UserError("開始月を正しく入力してください");
  const endMonth = input.endMonth || null;
  if (endMonth && (!MONTH.test(endMonth) || endMonth < input.startMonth)) throw new UserError("終了月は開始月以降にしてください");
  const template = await prisma.invoice.findFirst({
    where: { id: input.templateInvoiceId, companyId, direction: "ISSUED" },
    include: { _count: { select: { lines: true } } },
  });
  if (!template || template._count.lines === 0) throw new UserError("ひな形にする請求書を選んでください(この画面で作成した請求書だけ使えます)");
  return { name, templateInvoiceId: template.id, issueDay: input.issueDay, dueDays: input.dueDays, startMonth: input.startMonth, endMonth };
}

export async function createRecurringInvoice(companyId: string, input: RecurringInvoiceInput) {
  return prisma.recurringInvoice.create({ data: { companyId, ...(await validate(companyId, input)) } });
}

export async function setRecurringInvoiceActive(companyId: string, id: string, active: boolean) {
  const updated = await prisma.recurringInvoice.updateMany({ where: { id, companyId }, data: { active } });
  if (updated.count !== 1) throw new UserError("定期請求が見つかりません");
}

// 定義を消しても、作成済みの請求書は残る
export async function deleteRecurringInvoice(companyId: string, id: string) {
  const deleted = await prisma.recurringInvoice.deleteMany({ where: { id, companyId } });
  if (deleted.count !== 1) throw new UserError("定期請求が見つかりません");
}

export async function listRecurringInvoices(companyId: string, today = jstDateKey(new Date())) {
  const items = await prisma.recurringInvoice.findMany({
    where: { companyId },
    include: {
      templateInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, customer: { select: { name: true } } } },
      runs: { include: { invoice: { select: { id: true, invoiceNumber: true, status: true } } }, orderBy: { month: "desc" } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  const current = today.slice(0, 7);
  const earliest = addMonths(current, -(MAX_BACKFILL - 1));
  return items.map((r) => {
    // 取り消した請求書の月は、作り直せるように「未発行」に戻す
    const issued = new Set(r.runs.filter((run) => run.invoice.status !== "CANCELLED").map((run) => run.month));
    const due: string[] = [];
    if (r.active) {
      for (let m = r.startMonth > earliest ? r.startMonth : earliest; m <= current; m = addMonths(m, 1)) {
        if (r.endMonth && m > r.endMonth) break;
        if (!issued.has(m) && postingDate(m, r.issueDay) <= today) due.push(m);
      }
    }
    return {
      id: r.id,
      name: r.name,
      issueDay: r.issueDay,
      dueDays: r.dueDays,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      active: r.active,
      template: { id: r.templateInvoice.id, invoiceNumber: r.templateInvoice.invoiceNumber, totalAmount: r.templateInvoice.totalAmount, customerName: r.templateInvoice.customer?.name ?? "" },
      runs: r.runs.slice(0, 6).map((run) => ({ month: run.month, invoiceId: run.invoice.id, invoiceNumber: run.invoice.invoiceNumber, status: run.invoice.status })),
      due,
    };
  });
}

// 指定した月の請求書をひな形から作る(売上の仕訳も自動)。同じ月に2枚できないよう、記録の一意制約で守る。
export async function issueRecurringInvoice(companyId: string, id: string, month: string, today = jstDateKey(new Date())) {
  const item = (await listRecurringInvoices(companyId, today)).find((r) => r.id === id);
  if (!item) throw new UserError("定期請求が見つかりません");
  if (!item.due.includes(month)) throw new UserError(`${month} 分は作成できません(作成済み・請求日前・期間外のいずれかです)`);
  const template = await prisma.invoice.findFirstOrThrow({
    where: { id: item.template.id, companyId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, customer: true },
  });
  const issueDate = postingDate(month, item.issueDay);
  const invoice = await issueInvoice(companyId, {
    customerName: template.customer?.name ?? "",
    issueDate,
    dueDate: dueDateFor(issueDate, item.dueDays),
    notes: template.notes,
    lines: template.lines,
  });
  try {
    const previous = await prisma.recurringInvoiceRun.findUnique({ where: { recurringInvoiceId_month: { recurringInvoiceId: id, month } } });
    if (previous) {
      const moved = await prisma.recurringInvoiceRun.updateMany({ where: { id: previous.id, invoiceId: previous.invoiceId }, data: { invoiceId: invoice.id } });
      if (moved.count !== 1) throw new UserError(`${month} 分はすでに作成されています`);
    } else {
      await prisma.recurringInvoiceRun.create({ data: { recurringInvoiceId: id, month, invoiceId: invoice.id } });
    }
  } catch (error) {
    // 同時に作られていたら、今作った方の請求書(と仕訳)を取り消して重複を残さない
    await cancelIssuedInvoice(companyId, invoice.id).catch(() => {});
    if ((error as { code?: string }).code === "P2002" || error instanceof UserError) throw new UserError(`${month} 分はすでに作成されています`);
    throw error;
  }
  return invoice;
}

export async function issueAllDueInvoices(companyId: string, today = jstDateKey(new Date())) {
  const items = await listRecurringInvoices(companyId, today);
  let issued = 0;
  const errors: string[] = [];
  for (const r of items) {
    for (const month of r.due) {
      try {
        await issueRecurringInvoice(companyId, r.id, month, today);
        issued++;
      } catch (error) {
        errors.push(`${r.name} ${month}: ${error instanceof Error ? error.message : "失敗しました"}`);
      }
    }
  }
  return { issued, errors };
}

export async function countDueRecurringInvoices(companyId: string) {
  return (await listRecurringInvoices(companyId)).reduce((s, r) => s + r.due.length, 0);
}
