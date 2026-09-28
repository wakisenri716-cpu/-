import type { AllocationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError, toBooksClosedError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount, ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { cashAccountCodes } from "@/lib/bank/accounts";

// 期間按分: 1年分の保険料・ソフトの年額などをまとめて払ったら「前払費用」、
// 保守料・年会費などをまとめて受け取ったら「前受金」にしておき、毎月1か月分ずつ費用・売上にする。

export const KINDS: Record<AllocationKind, { label: string; balanceCode: string; balanceName: string; plCategory: "EXPENSE" | "REVENUE" }> = {
  PREPAID_EXPENSE: { label: "前払費用(まとめて払った費用)", balanceCode: "1230", balanceName: "前払費用", plCategory: "EXPENSE" },
  DEFERRED_REVENUE: { label: "前受金(まとめて受け取った売上)", balanceCode: "2130", balanceName: "前受金", plCategory: "REVENUE" },
};
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 月末の日付(按分の仕訳の日付)
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0));
}

// 毎月の額: 割り切れない端数は最後の月に寄せる
export function scheduleOf(a: { totalAmount: number; startMonth: string; months: number }) {
  const base = Math.floor(a.totalAmount / a.months);
  return Array.from({ length: a.months }, (_, i) => ({ month: addMonths(a.startMonth, i), amount: i === a.months - 1 ? a.totalAmount - base * (a.months - 1) : base }));
}

type Input = {
  kind?: unknown;
  name?: unknown;
  totalAmount?: unknown;
  startMonth?: unknown;
  months?: unknown;
  accountCode?: unknown;
  projectId?: unknown;
  notes?: unknown;
  // 支払・入金の仕訳も作るとき
  opening?: { date?: unknown; counterCode?: unknown } | null;
};

// 支払・入金の相手科目に選べるもの: 現金・預金(登録した口座も)と、未払金(費用)・売掛金(売上)
export async function counterAccounts(companyId: string) {
  const cash = await cashAccountCodes(companyId);
  const accounts = await prisma.account.findMany({ where: { companyId, code: { in: [...cash, "2020", "1110"] } }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  return {
    PREPAID_EXPENSE: accounts.filter((a) => a.code !== "1110"),
    DEFERRED_REVENUE: accounts.filter((a) => a.code !== "2020"),
  };
}

async function parse(companyId: string, input: Input) {
  const kind = String(input.kind ?? "") as AllocationKind;
  if (!(kind in KINDS)) throw new UserError("按分の種類を選んでください");
  const name = String(input.name ?? "").trim();
  if (!name) throw new UserError("名前を入力してください");
  if (name.length > 60) throw new UserError("名前は60文字以内で入力してください");
  const totalAmount = Number(String(input.totalAmount ?? "").replaceAll(",", "").trim());
  if (!Number.isInteger(totalAmount) || totalAmount <= 0 || totalAmount > 10_000_000_000) throw new UserError("金額は1円以上の整数で入力してください");
  const startMonth = String(input.startMonth ?? "");
  if (!MONTH.test(startMonth)) throw new UserError("開始月を選んでください");
  const months = Number(input.months);
  if (!Number.isInteger(months) || months < 2 || months > 120) throw new UserError("按分する月数は2〜120か月で入力してください");
  if (totalAmount < months) throw new UserError("金額が月数より小さいため按分できません");
  const accountCode = String(input.accountCode ?? "");
  const account = await prisma.account.findUnique({ where: { companyId_code: { companyId, code: accountCode } } });
  if (!account || account.category !== KINDS[kind].plCategory) throw new UserError(kind === "PREPAID_EXPENSE" ? "費用の科目を選んでください" : "売上の科目を選んでください");
  let projectId: string | null = String(input.projectId ?? "").trim() || null;
  if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, companyId } }))) projectId = null;
  const notes = String(input.notes ?? "").trim();
  if (notes.length > 300) throw new UserError("メモは300文字以内で入力してください");
  return { kind, name, totalAmount, startMonth, months, accountCode, projectId, notes: notes || null };
}

export async function createAllocation(companyId: string, input: Input) {
  const data = await parse(companyId, input);
  let opening: { date: Date; counterCode: string } | null = null;
  if (input.opening) {
    const date = String(input.opening.date ?? "");
    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("支払・入金の日付を正しく入力してください");
    const counterCode = String(input.opening.counterCode ?? "");
    if (!(await counterAccounts(companyId))[data.kind].some((a) => a.code === counterCode)) throw new UserError("支払・入金の科目を選んでください");
    opening = { date: new Date(`${date}T00:00:00Z`), counterCode };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      let openingEntryId: string | null = null;
      if (opening) {
        const balance = await ensureAccount(tx, companyId, KINDS[data.kind].balanceCode);
        const counter = await ensureAccount(tx, companyId, opening.counterCode);
        // 費用: 前払費用 / 預金など  売上: 預金など / 前受金
        const [debit, credit] = data.kind === "PREPAID_EXPENSE" ? [balance, counter] : [counter, balance];
        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            date: opening.date,
            description: `${data.name}(${KINDS[data.kind].balanceName})`,
            sourceType: "ALLOCATION",
            status: "POSTED_MANUALLY",
            projectId: data.projectId,
            lines: {
              create: [
                { accountId: debit.id, debit: data.totalAmount, credit: 0, memo: data.name },
                { accountId: credit.id, debit: 0, credit: data.totalAmount, memo: data.name },
              ],
            },
          },
        });
        openingEntryId = entry.id;
      }
      return tx.allocation.create({ data: { companyId, ...data, openingEntryId } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

// 名前・メモ・案件と、止める/再開だけ変えられる(金額・期間は計上が始まると変えられない)
export async function updateAllocation(companyId: string, id: string, input: Input & { active?: unknown }) {
  const current = await prisma.allocation.findFirst({ where: { id, companyId }, include: { _count: { select: { postings: true } } } });
  if (!current) throw new UserError("按分が見つかりません");
  if (typeof input.active === "boolean" && Object.keys(input).length === 1) return prisma.allocation.update({ where: { id }, data: { active: input.active } });
  const data = await parse(companyId, {
    ...input,
    kind: current.kind,
    ...(current._count.postings ? { totalAmount: current.totalAmount, startMonth: current.startMonth, months: current.months, accountCode: current.accountCode } : {}),
  });
  if (current.openingEntryId && data.totalAmount !== current.totalAmount) throw new UserError("支払・入金の仕訳を作った按分は、金額を変えられません。削除して登録し直してください");
  return prisma.allocation.update({ where: { id }, data: { ...data, kind: current.kind } });
}

export async function deleteAllocation(companyId: string, id: string) {
  const current = await prisma.allocation.findFirst({ where: { id, companyId }, include: { _count: { select: { postings: true } } } });
  if (!current) throw new UserError("按分が見つかりません");
  if (current._count.postings) throw new UserError("計上した月がある按分は削除できません。先に計上を取り消すか、「止める」にしてください");
  try {
    await prisma.$transaction(async (tx) => {
      if (current.openingEntryId) await tx.journalEntry.update({ where: { id: current.openingEntryId }, data: { status: "VOID" } });
      await tx.allocation.update({ where: { id }, data: { openingEntryId: null } });
      await tx.allocation.delete({ where: { id } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return current;
}

export async function listAllocations(companyId: string, now = new Date()) {
  const thisMonth = jstDateKey(now).slice(0, 7);
  // 前払費用・前受金・保険料など、あとから足した科目を用意しておく
  await ensureChartOfAccounts(companyId);
  const [items, accounts, projects, counters] = await Promise.all([
    prisma.allocation.findMany({
      where: { companyId },
      include: { postings: { orderBy: { month: "asc" } }, project: { select: { id: true, name: true } }, openingEntry: { select: { date: true, status: true } } },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
    prisma.account.findMany({ where: { companyId, category: { in: ["EXPENSE", "REVENUE"] }, hidden: false }, select: { code: true, name: true, category: true }, orderBy: { code: "asc" } }),
    prisma.project.findMany({ where: { companyId, active: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    counterAccounts(companyId),
  ]);
  const names = new Map(accounts.map((a) => [a.code, a.name]));
  const rows = items.map((a) => {
    const posted = new Map(a.postings.map((p) => [p.month, p]));
    const schedule = scheduleOf(a).map((s) => ({ ...s, posted: posted.has(s.month) }));
    const postedAmount = a.postings.reduce((s, p) => s + p.amount, 0);
    const due = a.active ? schedule.filter((s) => !s.posted && s.month <= thisMonth).map((s) => s.month) : [];
    return {
      id: a.id,
      kind: a.kind,
      name: a.name,
      totalAmount: a.totalAmount,
      startMonth: a.startMonth,
      endMonth: addMonths(a.startMonth, a.months - 1),
      months: a.months,
      accountCode: a.accountCode,
      accountName: names.get(a.accountCode) ?? a.accountCode,
      project: a.project,
      notes: a.notes,
      active: a.active,
      opening: a.openingEntry && a.openingEntry.status !== "VOID" ? { date: jstDateKey(a.openingEntry.date) } : null,
      schedule,
      postedCount: a.postings.length,
      postedAmount,
      remaining: a.totalAmount - postedAmount,
      lastPosted: a.postings.at(-1)?.month ?? null,
      due,
      done: a.postings.length === a.months,
    };
  });
  const sum = (kind: AllocationKind, f: (r: (typeof rows)[number]) => number) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + f(r), 0);
  const thisMonthAmount = (r: (typeof rows)[number]) => r.schedule.find((s) => s.month === thisMonth)?.amount ?? 0;
  return {
    thisMonth,
    rows,
    accounts,
    projects,
    counters,
    summary: {
      prepaidRemaining: sum("PREPAID_EXPENSE", (r) => r.remaining),
      deferredRemaining: sum("DEFERRED_REVENUE", (r) => r.remaining),
      expenseThisMonth: sum("PREPAID_EXPENSE", (r) => (r.active ? thisMonthAmount(r) : 0)),
      revenueThisMonth: sum("DEFERRED_REVENUE", (r) => (r.active ? thisMonthAmount(r) : 0)),
      due: rows.reduce((s, r) => s + r.due.length, 0),
    },
  };
}

// 1か月分を計上する(日付は月末)。前の月から順に計上する
export async function postMonth(companyId: string, id: string, month: string, now = new Date()) {
  const a = await prisma.allocation.findFirst({ where: { id, companyId }, include: { postings: { select: { month: true } } } });
  if (!a) throw new UserError("按分が見つかりません");
  if (!a.active) throw new UserError("止めている按分は計上できません");
  const schedule = scheduleOf(a);
  const item = schedule.find((s) => s.month === month);
  if (!item) throw new UserError(`${month} は按分の期間外です`);
  if (month > jstDateKey(now).slice(0, 7)) throw new UserError("まだ来ていない月は計上できません");
  const posted = new Set(a.postings.map((p) => p.month));
  if (posted.has(month)) throw new UserError(`${month} 分はすでに計上しています`);
  const earlier = schedule.find((s) => s.month < month && !posted.has(s.month));
  if (earlier) throw new UserError(`先に ${earlier.month} 分を計上してください`);
  try {
    return await prisma.$transaction(async (tx) => {
      const pl = await ensureAccount(tx, companyId, a.accountCode);
      const balance = await ensureAccount(tx, companyId, KINDS[a.kind].balanceCode);
      // 費用: 費用科目 / 前払費用  売上: 前受金 / 売上科目
      const [debit, credit] = a.kind === "PREPAID_EXPENSE" ? [pl, balance] : [balance, pl];
      const [, m] = month.split("-").map(Number);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: monthEnd(month),
          description: `${a.name} ${m}月分(${schedule.indexOf(item) + 1}/${a.months})`,
          sourceType: "ALLOCATION",
          status: "POSTED_MANUALLY",
          projectId: a.projectId,
          lines: {
            create: [
              { accountId: debit.id, debit: item.amount, credit: 0, memo: a.name },
              { accountId: credit.id, debit: 0, credit: item.amount, memo: a.name },
            ],
          },
        },
      });
      // 同時に押されても二重にならないよう、一意制約で守る
      await tx.allocationPosting.create({ data: { allocationId: a.id, month, amount: item.amount, journalEntryId: entry.id } });
      return { allocation: a, month, amount: item.amount };
    });
  } catch (error) {
    const closed = toBooksClosedError(error);
    if (closed) throw closed;
    if ((error as { code?: string }).code === "P2002") throw new UserError(`${month} 分はすでに計上しています`);
    throw error;
  }
}

// 最後に計上した月を取り消す(仕訳は取消にする)
export async function undoLastPosting(companyId: string, id: string) {
  const a = await prisma.allocation.findFirst({ where: { id, companyId }, include: { postings: { orderBy: { month: "desc" }, take: 1 } } });
  if (!a) throw new UserError("按分が見つかりません");
  const last = a.postings[0];
  if (!last) throw new UserError("取り消す計上がありません");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.allocationPosting.delete({ where: { id: last.id } });
      await tx.journalEntry.update({ where: { id: last.journalEntryId }, data: { status: "VOID" } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return { allocation: a, month: last.month, amount: last.amount };
}

// 今月までの未計上分をまとめて計上する
export async function postAllDue(companyId: string, now = new Date()) {
  const { rows } = await listAllocations(companyId, now);
  let posted = 0;
  const errors: string[] = [];
  for (const r of rows) {
    for (const month of r.due) {
      try {
        await postMonth(companyId, r.id, month, now);
        posted++;
      } catch (error) {
        errors.push(`${r.name} ${month}: ${error instanceof Error ? error.message : "失敗しました"}`);
        break;
      }
    }
  }
  return { posted, errors };
}

export async function countDueAllocations(companyId: string, now = new Date()) {
  const thisMonth = jstDateKey(now).slice(0, 7);
  const items = await prisma.allocation.findMany({ where: { companyId, active: true, startMonth: { lte: thisMonth } }, select: { startMonth: true, months: true, _count: { select: { postings: true } } } });
  return items.reduce((s, a) => {
    const elapsed = Math.min(a.months, monthsBetween(a.startMonth, thisMonth) + 1);
    return s + Math.max(0, elapsed - a._count.postings);
  }, 0);
}

function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
