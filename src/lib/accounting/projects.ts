import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import type { DateRange } from "./period";

// 案件別損益: 仕訳に案件を付けて、案件ごとに売上(収益の科目)・原価と経費(費用の科目)・利益を出す。
// 請求書の発行・発注書の検収・手入力の仕訳で案件を選べるほか、仕訳帳であとから付け替えられる。

const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ProjectInput = {
  name?: unknown;
  customerName?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  budgetRevenue?: unknown;
  budgetCost?: unknown;
  notes?: unknown;
  active?: unknown;
};

function optionalDate(value: unknown, label: string) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new UserError(`${label}を正しく入力してください`);
  return new Date(`${v}T00:00:00Z`);
}

function optionalYen(value: unknown, label: string) {
  const v = String(value ?? "").replaceAll(",", "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000_000) throw new UserError(`${label}は0以上の整数(円)で入力してください`);
  return n;
}

function optionalText(value: unknown, max: number, label: string) {
  const v = String(value ?? "").trim();
  if (v.length > max) throw new UserError(`${label}は${max}文字以内で入力してください`);
  return v || null;
}

async function parse(companyId: string, input: ProjectInput, exceptId?: string) {
  const name = String(input.name ?? "").normalize("NFKC").trim();
  if (!name) throw new UserError("案件名を入力してください");
  if (name.length > 50) throw new UserError("案件名は50文字以内にしてください");
  if (await prisma.project.findFirst({ where: { companyId, name, ...(exceptId ? { id: { not: exceptId } } : {}) } })) throw new UserError(`「${name}」はすでにあります`);
  const startDate = optionalDate(input.startDate, "開始日");
  const endDate = optionalDate(input.endDate, "終了日");
  if (startDate && endDate && endDate < startDate) throw new UserError("終了日は開始日以降にしてください");
  return {
    name,
    customerName: optionalText(input.customerName, 100, "顧客"),
    startDate,
    endDate,
    budgetRevenue: optionalYen(input.budgetRevenue, "受注額(予算)"),
    budgetCost: optionalYen(input.budgetCost, "原価の予算"),
    notes: optionalText(input.notes, 500, "メモ"),
  };
}

export async function createProject(companyId: string, input: ProjectInput) {
  return prisma.project.create({ data: { companyId, ...(await parse(companyId, input)) } });
}

// 「完了にする」「再開する」ボタンからの変更(active だけが送られてくる)
export function onlyActive(input: ProjectInput): input is { active: boolean } {
  return typeof input.active === "boolean" && Object.keys(input).every((k) => k === "active");
}

export async function updateProject(companyId: string, id: string, input: ProjectInput) {
  const project = await prisma.project.findFirst({ where: { id, companyId } });
  if (!project) throw new UserError("案件が見つかりません");
  // 「完了にする」「再開する」だけのときは、ほかの項目を変えない
  if (onlyActive(input)) return prisma.project.update({ where: { id }, data: { active: input.active } });
  // 送られてこなかった項目は今の値のまま
  const current: ProjectInput = {
    name: project.name,
    customerName: project.customerName,
    startDate: project.startDate ? jstDateKey(project.startDate) : null,
    endDate: project.endDate ? jstDateKey(project.endDate) : null,
    budgetRevenue: project.budgetRevenue,
    budgetCost: project.budgetCost,
    notes: project.notes,
  };
  const merged = Object.fromEntries(Object.entries(current).map(([k, v]) => [k, input[k as keyof ProjectInput] === undefined ? v : input[k as keyof ProjectInput]]));
  const data = await parse(companyId, merged, id);
  return prisma.project.update({ where: { id }, data: { ...data, ...(typeof input.active === "boolean" ? { active: input.active } : {}) } });
}

export async function listActiveProjects(companyId: string) {
  return prisma.project.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}

// 仕訳に付ける案件が、この会社の進行中の案件か確かめる(null は「案件なし」)
export async function resolveProjectId(companyId: string, projectId: unknown) {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({ where: { id: String(projectId), companyId, active: true } });
  if (!project) throw new UserError("案件が見つかりません(進行中の案件を選んでください)");
  return project.id;
}

// 仕訳の案件を付け替える(締めた期間の仕訳はデータベースのトリガーが拒否する)
export async function setEntryProject(companyId: string, entryId: string, projectId: unknown) {
  const resolved = await resolveProjectId(companyId, projectId);
  const updated = await prisma.journalEntry.updateMany({ where: { id: entryId, companyId }, data: { projectId: resolved } });
  if (updated.count !== 1) throw new UserError("仕訳が見つかりません");
}

type Line = { debit: number; credit: number; account: { id: string; code: string; name: string; category: string }; journalEntry: { projectId: string | null } };

function amountOf(l: Line) {
  return l.account.category === "REVENUE" ? l.credit - l.debit : l.debit - l.credit;
}

async function plLines(companyId: string, range: DateRange, projectId?: string) {
  return prisma.journalLine.findMany({
    where: {
      account: { companyId, category: { in: ["REVENUE", "EXPENSE"] } },
      journalEntry: { companyId, status: { in: [...POSTED] }, ...(projectId ? { projectId } : { projectId: { not: null } }), ...(range.gte || range.lt ? { date: range } : {}) },
    },
    select: { debit: true, credit: true, account: { select: { id: true, code: true, name: true, category: true } }, journalEntry: { select: { projectId: true } } },
  });
}

function summarize(revenue: number, cost: number) {
  const profit = revenue - cost;
  return { revenue, cost, profit, margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null };
}

// 案件の一覧と、それぞれの売上・原価と経費・利益・利益率、予算に対する進み具合
export async function getProjectSummaries(companyId: string, range: DateRange = {}) {
  const [projects, lines] = await Promise.all([prisma.project.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }), plLines(companyId, range)]);
  const sums = new Map<string, { revenue: number; cost: number }>();
  for (const l of lines) {
    const s = sums.get(l.journalEntry.projectId!) ?? { revenue: 0, cost: 0 };
    if (l.account.category === "REVENUE") s.revenue += amountOf(l);
    else s.cost += amountOf(l);
    sums.set(l.journalEntry.projectId!, s);
  }
  const rows = projects.map((p) => {
    const s = sums.get(p.id) ?? { revenue: 0, cost: 0 };
    const budgetProfit = p.budgetRevenue !== null && p.budgetCost !== null ? p.budgetRevenue - p.budgetCost : null;
    return {
      id: p.id,
      name: p.name,
      customerName: p.customerName,
      startDate: p.startDate ? jstDateKey(p.startDate) : null,
      endDate: p.endDate ? jstDateKey(p.endDate) : null,
      budgetRevenue: p.budgetRevenue,
      budgetCost: p.budgetCost,
      budgetProfit,
      notes: p.notes,
      active: p.active,
      ...summarize(s.revenue, s.cost),
      // 原価の予算をどれだけ使ったか(%)
      costUsed: p.budgetCost ? Math.round((s.cost / p.budgetCost) * 1000) / 10 : null,
    };
  });
  const total = summarize(
    rows.reduce((s, r) => s + r.revenue, 0),
    rows.reduce((s, r) => s + r.cost, 0),
  );
  return { rows, total };
}

// 1つの案件の科目ごとの内訳と、付いている仕訳
export async function getProjectDetail(companyId: string, id: string, range: DateRange = {}) {
  const project = await prisma.project.findFirst({ where: { id, companyId } });
  if (!project) return null;
  const [lines, entries] = await Promise.all([
    plLines(companyId, range, id),
    prisma.journalEntry.findMany({
      where: { companyId, projectId: id, status: { in: [...POSTED] }, ...(range.gte || range.lt ? { date: range } : {}) },
      include: { lines: { include: { account: { select: { code: true, name: true, category: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
  ]);
  const byAccount = new Map<string, { code: string; name: string; category: string; amount: number }>();
  for (const l of lines) {
    const row = byAccount.get(l.account.id) ?? { code: l.account.code, name: l.account.name, category: l.account.category, amount: 0 };
    row.amount += amountOf(l);
    byAccount.set(l.account.id, row);
  }
  const accounts = [...byAccount.values()].filter((a) => a.amount !== 0).sort((a, b) => a.code.localeCompare(b.code));
  const revenue = accounts.filter((a) => a.category === "REVENUE");
  const expense = accounts.filter((a) => a.category === "EXPENSE");
  return {
    project: {
      ...project,
      startDate: project.startDate ? jstDateKey(project.startDate) : null,
      endDate: project.endDate ? jstDateKey(project.endDate) : null,
    },
    revenue,
    expense,
    totals: summarize(
      revenue.reduce((s, a) => s + a.amount, 0),
      expense.reduce((s, a) => s + a.amount, 0),
    ),
    entries: entries.map((e) => {
      // 損益に効く額(収益 − 費用)。入金・支払など損益に関係ない仕訳は0
      const pl = e.lines.reduce((s, l) => s + (l.account.category === "REVENUE" ? l.credit - l.debit : l.account.category === "EXPENSE" ? -(l.debit - l.credit) : 0), 0);
      return { id: e.id, date: jstDateKey(e.date), description: e.description, pl, amount: e.lines.reduce((s, l) => s + l.debit, 0) };
    }),
  };
}
