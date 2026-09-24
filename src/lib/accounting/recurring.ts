import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { JournalError, validateJournalLines, type ManualLineInput } from "./journal";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// 記帳漏れをさかのぼって拾うのは最大12か月分まで
const MAX_BACKFILL = 12;

export type RecurringInput = {
  name: string;
  description: string;
  dayOfMonth: number;
  startMonth: string;
  endMonth?: string | null;
  lines: ManualLineInput[];
};

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// その月の記帳日(0 = 月末。29日以降を指定しても短い月は月末に寄せる)
export function postingDate(month: string, dayOfMonth: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = dayOfMonth === 0 ? last : Math.min(dayOfMonth, last);
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function dayLabel(dayOfMonth: number) {
  return dayOfMonth === 0 ? "毎月末" : `毎月${dayOfMonth}日`;
}

async function validate(companyId: string, input: RecurringInput) {
  const name = input.name.trim();
  const description = input.description.trim() || name;
  if (!name) throw new JournalError("名前を入力してください");
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 0 || input.dayOfMonth > 28) {
    throw new JournalError("記帳日は1〜28日、または月末を選んでください");
  }
  if (!MONTH.test(input.startMonth)) throw new JournalError("開始月を正しく入力してください");
  const endMonth = input.endMonth || null;
  if (endMonth && (!MONTH.test(endMonth) || endMonth < input.startMonth)) throw new JournalError("終了月は開始月以降にしてください");
  const lines = await validateJournalLines(companyId, input.lines);
  return { name, description, dayOfMonth: input.dayOfMonth, startMonth: input.startMonth, endMonth, lines };
}

function lineData(lines: ManualLineInput[]) {
  return lines.map((l, i) => ({ sortOrder: i, accountId: l.accountId, debit: l.debit, credit: l.credit }));
}

export async function createRecurring(companyId: string, input: RecurringInput) {
  const v = await validate(companyId, input);
  return prisma.recurringEntry.create({ data: { companyId, ...v, lines: { create: lineData(v.lines) } } });
}

export async function updateRecurring(companyId: string, id: string, input: RecurringInput & { active?: boolean }) {
  const existing = await prisma.recurringEntry.findFirst({ where: { id, companyId } });
  if (!existing) throw new JournalError("定期取引が見つかりません");
  const v = await validate(companyId, input);
  return prisma.$transaction(async (tx) => {
    await tx.recurringLine.deleteMany({ where: { recurringEntryId: id } });
    return tx.recurringEntry.update({
      where: { id },
      data: { ...v, ...(typeof input.active === "boolean" ? { active: input.active } : {}), lines: { create: lineData(v.lines) } },
    });
  });
}

export async function setRecurringActive(companyId: string, id: string, active: boolean) {
  const updated = await prisma.recurringEntry.updateMany({ where: { id, companyId }, data: { active } });
  if (updated.count !== 1) throw new JournalError("定期取引が見つかりません");
}

// 定義を消しても、すでに記帳した仕訳は帳簿に残る
export async function deleteRecurring(companyId: string, id: string) {
  const deleted = await prisma.recurringEntry.deleteMany({ where: { id, companyId } });
  if (deleted.count !== 1) throw new JournalError("定期取引が見つかりません");
}

// 記帳日が来ているのにまだ記帳していない月(取り消した月も含む)
function dueMonths(entry: { active: boolean; dayOfMonth: number; startMonth: string; endMonth: string | null; createdAt: Date }, posted: Set<string>, today: string) {
  if (!entry.active) return [];
  const current = today.slice(0, 7);
  const earliest = addMonths(current, -(MAX_BACKFILL - 1));
  const months: string[] = [];
  for (let m = entry.startMonth > earliest ? entry.startMonth : earliest; m <= current; m = addMonths(m, 1)) {
    if (entry.endMonth && m > entry.endMonth) break;
    if (!posted.has(m) && postingDate(m, entry.dayOfMonth) <= today) months.push(m);
  }
  return months;
}

export async function listRecurring(companyId: string, today = jstDateKey(new Date())) {
  const entries = await prisma.recurringEntry.findMany({
    where: { companyId },
    include: {
      lines: { orderBy: { sortOrder: "asc" }, include: { account: { select: { id: true, code: true, name: true } } } },
      postings: { include: { journalEntry: { select: { status: true, date: true } } }, orderBy: { month: "desc" } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return entries.map((e) => {
    const posted = new Set(e.postings.filter((p) => p.journalEntry.status !== "VOID").map((p) => p.month));
    const amount = e.lines.reduce((s, l) => s + l.debit, 0);
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      dayOfMonth: e.dayOfMonth,
      startMonth: e.startMonth,
      endMonth: e.endMonth,
      active: e.active,
      amount,
      lines: e.lines.map((l) => ({ accountId: l.accountId, account: l.account, debit: l.debit, credit: l.credit })),
      lastPosted: [...posted].sort().pop() ?? null,
      due: dueMonths(e, posted, today),
    };
  });
}

// 指定した月の分を記帳する(記帳日は定義の日付)。二重記帳は一意制約で防ぐ。
export async function postRecurring(companyId: string, id: string, month: string, today = jstDateKey(new Date())) {
  const entry = (await listRecurring(companyId, today)).find((e) => e.id === id);
  if (!entry) throw new JournalError("定期取引が見つかりません");
  if (!entry.due.includes(month)) throw new JournalError(`${month} 分は記帳できません(記帳済み・記帳日前・期間外のいずれかです)`);

  return prisma.$transaction(async (tx) => {
    const journal = await tx.journalEntry.create({
      data: {
        companyId,
        date: new Date(`${postingDate(month, entry.dayOfMonth)}T00:00:00Z`),
        description: entry.description,
        sourceType: "RECURRING",
        status: "POSTED_MANUALLY",
        lines: { create: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: entry.name })) },
      },
    });
    // 取り消した月をやり直すときは、前回の記録を新しい仕訳に付け替える
    const previous = await tx.recurringPosting.findUnique({ where: { recurringEntryId_month: { recurringEntryId: id, month } }, include: { journalEntry: true } });
    if (previous && previous.journalEntry.status !== "VOID") throw new JournalError(`${month} 分はすでに記帳されています`);
    if (previous) {
      const moved = await tx.recurringPosting.updateMany({ where: { id: previous.id, journalEntryId: previous.journalEntryId }, data: { journalEntryId: journal.id } });
      if (moved.count !== 1) throw new JournalError(`${month} 分はすでに記帳されています`);
    } else await tx.recurringPosting.create({ data: { recurringEntryId: id, month, journalEntryId: journal.id } });
    return journal;
  });
}

// 記帳日が来ている未記帳分をすべて記帳する
export async function postAllDue(companyId: string, today = jstDateKey(new Date())) {
  const entries = await listRecurring(companyId, today);
  let posted = 0;
  const errors: string[] = [];
  for (const e of entries) {
    for (const month of e.due) {
      try {
        await postRecurring(companyId, e.id, month, today);
        posted++;
      } catch (error) {
        errors.push(`${e.name} ${month}: ${error instanceof Error ? error.message : "失敗しました"}`);
      }
    }
  }
  return { posted, errors };
}

export async function countDueRecurring(companyId: string) {
  return (await listRecurring(companyId)).reduce((s, e) => s + e.due.length, 0);
}
