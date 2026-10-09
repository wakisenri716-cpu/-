import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { isBusinessDay } from "@/lib/holidays";

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
