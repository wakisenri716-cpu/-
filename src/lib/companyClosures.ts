import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { UserError } from "@/lib/errors";
import { isBusinessDay } from "@/lib/holidays";
import { createAnnouncement } from "@/lib/announcements";
import { closureNotice, groupClosures, staffAnnouncement } from "@/lib/closureNotice";

// 会社の休業日(夏季休業・創立記念日など)。国の祝日・土日・年末年始に足して「会社が休みの日」を決める。
// 税金・銀行の期限は国の決まりなので、ここの休業日は使わない(日程調整・朝のまとめ・営業日の数え方に使う)

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const valid = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export async function listClosures(companyId: string, from?: string) {
  return prisma.companyClosure.findMany({ where: { companyId, ...(from ? { date: { gte: from } } : {}) }, orderBy: { date: "asc" }, take: 400 });
}

export async function closureMap(companyId: string, from?: string) {
  return new Map((await listClosures(companyId, from)).map((c) => [c.date, c.name]));
}

// 会社が開いている日(営業日で、会社の休業日でもない)
export function isCompanyOpen(date: string, closures: Map<string, string>) {
  return isBusinessDay(date) && !closures.has(date);
}

// 期間(from〜to)をまとめて休業日にする(土日・祝日もそのまま入れる。最大31日)
export async function addClosures(companyId: string, raw: { from?: unknown; to?: unknown; name?: unknown }) {
  const from = raw.from;
  const to = raw.to || raw.from;
  if (!valid(from) || !valid(to)) throw new UserError("日付を正しく入れてください");
  if (to < from) throw new UserError("終わりの日が始まりの日より前です");
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 30) || "会社の休業日";
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > 31) throw new UserError("一度に入れられるのは31日までです");
  }
  await prisma.$transaction(dates.map((date) => prisma.companyClosure.upsert({ where: { companyId_date: { companyId, date } }, create: { companyId, date, name }, update: { name } })));
  return dates.length;
}

export async function removeClosures(companyId: string, raw: { dates?: unknown }) {
  const dates = (Array.isArray(raw.dates) ? raw.dates : []).filter(valid).slice(0, 100);
  if (!dates.length) throw new UserError("消す日を選んでください");
  const { count } = await prisma.companyClosure.deleteMany({ where: { companyId, date: { in: dates } } });
  return count;
}

// 休業日を社内のお知らせに出す(date は休業日のまとまりの最初の日)。同じお知らせは2度出さない
export async function announceClosure(
  user: { id: string; name: string; companyId: string; role: "ADMIN" | "ACCOUNTANT" | "EMPLOYEE" | "ADVISOR" },
  raw: { date?: unknown; notify?: unknown },
  request?: Request,
) {
  if (user.role === "EMPLOYEE" || user.role === "ADVISOR") throw new UserError("社内のお知らせは管理者・経理担当が出せます");
  if (!valid(raw.date)) throw new UserError("休業日を選んでください");
  const list = await listClosures(user.companyId);
  const group = groupClosures(list).find((g) => g.dates[0] === raw.date);
  if (!group) throw new UserError("その休業日が見つかりません");
  if (group.dates[group.dates.length - 1] < jstDateKey(new Date())) throw new UserError("終わった休業日です");
  const notice = closureNotice(group, new Map(list.map((c) => [c.date, c.name])));
  const text = staffAnnouncement(notice);
  const dup = await prisma.announcement.findFirst({ where: { companyId: user.companyId, title: text.title }, select: { id: true } });
  if (dup) throw new UserError("この休業日は、もう社内のお知らせに出しています");
  const result = await createAnnouncement(user, { ...text, pinned: false, notify: raw.notify === true }, request);
  return { ...result, notice };
}

// お休みの間(前後の土日・祝日を含む)が期限のやること(済んでいないもの)
export async function closureTasks(companyId: string, date: unknown) {
  if (!valid(date)) throw new UserError("休業日を選んでください");
  const list = await listClosures(companyId);
  const group = groupClosures(list).find((g) => g.dates[0] === date);
  if (!group) throw new UserError("その休業日が見つかりません");
  const closures = new Map(list.map((c) => [c.date, c.name]));
  const notice = closureNotice(group, closures);
  const tasks = await prisma.teamTask.findMany({ where: { companyId, status: "OPEN", dueOn: { gte: notice.from, lte: notice.to } }, select: { id: true, title: true, dueOn: true, ownerName: true }, orderBy: { dueOn: "asc" }, take: 200 });
  // 前倒し先: お休みの前の最後の営業日(会社の休業日も除く)
  let before = addDays(notice.from, -1);
  for (let i = 0; i < 60 && !isCompanyOpen(before, closures); i++) before = addDays(before, -1);
  return { notice, tasks, before };
}

// お休み中が期限のやることを、お休みの前の営業日に前倒しする(今日より前にはしない)
export async function shiftClosureTasks(user: { companyId: string; role: string }, raw: { date?: unknown }) {
  if (user.role === "EMPLOYEE" || user.role === "ADVISOR") throw new UserError("やることの前倒しは管理者・経理担当ができます");
  const { notice, tasks, before } = await closureTasks(user.companyId, raw.date);
  if (!tasks.length) throw new UserError("お休み中が期限のやることはありません");
  const today = jstDateKey(new Date());
  if (before < today) throw new UserError("お休みの前の営業日が過ぎているので、前倒しできません");
  const { count } = await prisma.teamTask.updateMany({ where: { id: { in: tasks.map((t) => t.id) }, companyId: user.companyId, status: "OPEN" }, data: { dueOn: before } });
  return { count, before, notice };
}
