import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import type { DateRange } from "@/lib/accounting/period";

// 日報(工数): 誰が・いつ・どの案件に・何時間・何をしたかを記録し、案件ごとの労務費(時間 × 単価)の目安を出す。
// 労務費は管理用の目安で、仕訳にはしない(給料は給与計算で計上する)。

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_LIMIT = 24 * 60;

export function currentMonth(now = new Date()) {
  return jstDateKey(now).slice(0, 7);
}

export function parseMonth(value: unknown, now = new Date()) {
  const v = String(value ?? "");
  return MONTH.test(v) ? v : currentMonth(now);
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

function parseDate(value: unknown) {
  const v = String(value ?? "").trim();
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new UserError("日付を正しく入力してください");
  return new Date(`${v}T00:00:00Z`);
}

// 「1.5」(時間)や「1:30」(時:分)を分にする
export function parseMinutes(value: unknown) {
  const v = String(value ?? "")
    .trim()
    .replace(/[０-９．：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let minutes = NaN;
  const hm = v.match(/^(\d{1,2}):([0-5]\d)$/);
  if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2]);
  else if (/^\d{1,2}(\.\d{1,2})?$/.test(v)) minutes = Math.round(Number(v) * 60);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > DAY_LIMIT) throw new UserError("時間は「1.5」(時間)か「1:30」の形で、24時間以内で入力してください");
  return minutes;
}

async function parseProject(companyId: string, value: unknown, keepId?: string | null) {
  const id = String(value ?? "").trim();
  if (!id) return null;
  const project = await prisma.project.findFirst({ where: { id, companyId } });
  if (!project) throw new UserError("案件が見つかりません");
  // 完了した案件には新しく付けられない(もともと付いていたものはそのまま)
  if (!project.active && project.id !== keepId) throw new UserError("完了した案件には記録できません");
  return project.id;
}

function parseTask(value: unknown) {
  const v = String(value ?? "").trim();
  if (v.length > 200) throw new UserError("作業内容は200文字以内で入力してください");
  return v || null;
}

// その人の時間単価: スタッフ(時給)にひも付いていればその時給、なければ会社の標準の時間単価
export async function rateFor(companyId: string, userId: string) {
  const [staff, company] = await Promise.all([
    prisma.staff.findFirst({ where: { companyId, userId }, select: { hourlyWage: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { laborCostRate: true } }),
  ]);
  return staff?.hourlyWage || company?.laborCostRate || 0;
}

async function checkDayTotal(userId: string, companyId: string, date: Date, minutes: number, exceptId?: string) {
  const sum = await prisma.workLog.aggregate({ where: { companyId, userId, date, ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { minutes: true } });
  if ((sum._sum.minutes ?? 0) + minutes > DAY_LIMIT) throw new UserError("1日の合計が24時間を超えます");
}

type LogInput = { date?: unknown; projectId?: unknown; hours?: unknown; task?: unknown };

export async function createWorkLog(companyId: string, userId: string, input: LogInput) {
  const date = parseDate(input.date);
  const minutes = parseMinutes(input.hours);
  const projectId = await parseProject(companyId, input.projectId);
  await checkDayTotal(userId, companyId, date, minutes);
  return prisma.workLog.create({
    data: { companyId, userId, date, minutes, projectId, task: parseTask(input.task), hourlyCost: await rateFor(companyId, userId) },
    include: { project: { select: { name: true } } },
  });
}

// 自分の日報だけ直せる
export async function updateWorkLog(companyId: string, userId: string, id: string, input: LogInput) {
  const log = await prisma.workLog.findFirst({ where: { id, companyId, userId } });
  if (!log) throw new UserError("日報が見つかりません");
  const date = input.date === undefined ? log.date : parseDate(input.date);
  const minutes = input.hours === undefined ? log.minutes : parseMinutes(input.hours);
  const projectId = input.projectId === undefined ? log.projectId : await parseProject(companyId, input.projectId, log.projectId);
  await checkDayTotal(userId, companyId, date, minutes, id);
  return prisma.workLog.update({
    where: { id },
    data: { date, minutes, projectId, task: input.task === undefined ? log.task : parseTask(input.task) },
    include: { project: { select: { name: true } } },
  });
}

// 本人か、管理者・経理担当が消せる
export async function deleteWorkLog(companyId: string, user: { id: string; role: string }, id: string) {
  const log = await prisma.workLog.findFirst({ where: { id, companyId, ...(user.role === "EMPLOYEE" ? { userId: user.id } : {}) }, include: { user: { select: { name: true } } } });
  if (!log) throw new UserError("日報が見つかりません");
  await prisma.workLog.delete({ where: { id } });
  return log;
}

// 自分の1か月分の日報(入力画面用)
export async function myWorkLogs(companyId: string, userId: string, monthValue: unknown, now = new Date()) {
  const month = parseMonth(monthValue, now);
  const [logs, projects] = await Promise.all([
    prisma.workLog.findMany({
      where: { companyId, userId, date: monthRange(month) },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    }),
    prisma.project.findMany({ where: { companyId, active: true }, select: { id: true, name: true, customerName: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const byProject = new Map<string, { name: string; minutes: number }>();
  for (const l of logs) {
    const key = l.project?.id ?? "";
    const row = byProject.get(key) ?? { name: l.project?.name ?? "社内の作業", minutes: 0 };
    row.minutes += l.minutes;
    byProject.set(key, row);
  }
  return {
    month,
    today: jstDateKey(now),
    projects,
    logs: logs.map((l) => ({ id: l.id, date: jstDateKey(l.date), projectId: l.projectId, projectName: l.project?.name ?? null, minutes: l.minutes, task: l.task })),
    totalMinutes: logs.reduce((s, l) => s + l.minutes, 0),
    byProject: [...byProject.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

const cost = (minutes: number, rate: number) => Math.round((minutes * rate) / 60);

// 会社全体の1か月分の集計: 案件ごと・人ごとの時間と労務費
export async function getWorkSummary(companyId: string, monthValue: unknown, now = new Date()) {
  const month = parseMonth(monthValue, now);
  const [logs, company] = await Promise.all([
    prisma.workLog.findMany({
      where: { companyId, date: monthRange(month) },
      include: { project: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.company.findUnique({ where: { id: companyId }, select: { laborCostRate: true } }),
  ]);
  type Sum = { id: string; name: string; minutes: number; cost: number; byOther: Map<string, number> };
  const projects = new Map<string, Sum>();
  const users = new Map<string, Sum>();
  const add = (map: Map<string, Sum>, id: string, name: string, minutes: number, c: number, other: string) => {
    const row = map.get(id) ?? { id, name, minutes: 0, cost: 0, byOther: new Map() };
    row.minutes += minutes;
    row.cost += c;
    row.byOther.set(other, (row.byOther.get(other) ?? 0) + minutes);
    map.set(id, row);
  };
  let zeroRate = 0;
  for (const l of logs) {
    const c = cost(l.minutes, l.hourlyCost);
    if (!l.hourlyCost) zeroRate++;
    add(projects, l.project?.id ?? "", l.project?.name ?? "社内の作業", l.minutes, c, l.user.id);
    add(users, l.user.id, l.user.name, l.minutes, c, l.project?.id ?? "");
  }
  const list = (map: Map<string, Sum>) =>
    [...map.values()]
      // 社内の作業は最後に
      .sort((a, b) => (a.id === "") !== (b.id === "") ? (a.id === "" ? 1 : -1) : b.minutes - a.minutes)
      .map((r) => ({ id: r.id, name: r.name, minutes: r.minutes, cost: r.cost, by: Object.fromEntries(r.byOther) }));
  return {
    month,
    laborCostRate: company?.laborCostRate ?? null,
    projects: list(projects),
    users: list(users),
    totalMinutes: logs.reduce((s, l) => s + l.minutes, 0),
    totalCost: logs.reduce((s, l) => s + cost(l.minutes, l.hourlyCost), 0),
    // 単価が0円のまま記録された日報の数(単価を決めてから「計算し直す」を押してもらう)
    zeroRate,
    logs: logs.map((l) => ({
      id: l.id,
      date: jstDateKey(l.date),
      userName: l.user.name,
      projectName: l.project?.name ?? "社内の作業",
      minutes: l.minutes,
      task: l.task,
      hourlyCost: l.hourlyCost,
      cost: cost(l.minutes, l.hourlyCost),
    })),
  };
}

export async function setLaborCostRate(companyId: string, value: unknown) {
  const raw = String(value ?? "").replaceAll(",", "").trim();
  const rate = raw === "" ? null : Number(raw);
  if (rate !== null && (!Number.isInteger(rate) || rate < 0 || rate > 100_000)) throw new UserError("時間単価は0〜100,000円の整数で入力してください");
  await prisma.company.update({ where: { id: companyId }, data: { laborCostRate: rate } });
  return rate;
}

// その月の日報の単価を、今の設定(スタッフの時給・標準の時間単価)で付け直す
export async function recalcMonth(companyId: string, monthValue: unknown) {
  const month = parseMonth(monthValue);
  const where = { companyId, date: monthRange(month) };
  const userIds = (await prisma.workLog.findMany({ where, distinct: ["userId"], select: { userId: true } })).map((l) => l.userId);
  let count = 0;
  for (const userId of userIds) {
    const r = await prisma.workLog.updateMany({ where: { ...where, userId }, data: { hourlyCost: await rateFor(companyId, userId) } });
    count += r.count;
  }
  return { month, count };
}

// 案件別損益に出す、案件ごとの工数と労務費
export async function laborByProject(companyId: string, range: DateRange = {}, projectId?: string) {
  const logs = await prisma.workLog.findMany({
    where: { companyId, ...(projectId ? { projectId } : { projectId: { not: null } }), ...(range.gte || range.lt ? { date: range } : {}) },
    select: { projectId: true, minutes: true, hourlyCost: true },
  });
  const map = new Map<string, { minutes: number; cost: number }>();
  for (const l of logs) {
    const row = map.get(l.projectId!) ?? { minutes: 0, cost: 0 };
    row.minutes += l.minutes;
    row.cost += cost(l.minutes, l.hourlyCost);
    map.set(l.projectId!, row);
  }
  return map;
}

// 案件の詳細に出す、人ごとの工数
export async function laborByUser(companyId: string, projectId: string, range: DateRange = {}) {
  const logs = await prisma.workLog.findMany({
    where: { companyId, projectId, ...(range.gte || range.lt ? { date: range } : {}) },
    select: { minutes: true, hourlyCost: true, user: { select: { id: true, name: true } } },
  });
  const map = new Map<string, { name: string; minutes: number; cost: number }>();
  for (const l of logs) {
    const row = map.get(l.user.id) ?? { name: l.user.name, minutes: 0, cost: 0 };
    row.minutes += l.minutes;
    row.cost += cost(l.minutes, l.hourlyCost);
    map.set(l.user.id, row);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}
