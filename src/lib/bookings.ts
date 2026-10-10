import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { normalizeName } from "@/lib/partyMerge";
import { relativeDue } from "@/lib/teamTasks";
import { closedReason } from "@/lib/holidays";
import { closureMap } from "@/lib/companyClosures";
import { FACILITY_KINDS, overlaps, parseTimeRange, validHM, type FacilityKind } from "@/lib/bookingText";

// 会議室・社用車の予約: 予約できるもの(会議室・社用車など)を登録し、「明日14時から15時 会議室A 来客打ち合わせ」のように
// 1行で予約する。同じものの時間が重なる予約は入れない。土日・祝日・会社の休業日は注意を出す。

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function listFacilities(companyId: string) {
  return prisma.facility.findMany({ where: { companyId, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
}

export async function saveFacility(user: { companyId: string; role: string }, raw: Record<string, unknown>) {
  if (user.role === "EMPLOYEE" || user.role === "ADVISOR") throw new UserError("予約できるものの登録は管理者・経理担当ができます");
  const name = clean(raw.name, 40);
  if (!name) throw new UserError("名前を入れてください(例: 会議室A・社用車プリウス)");
  const kind: FacilityKind = raw.kind === "CAR" || raw.kind === "OTHER" ? raw.kind : "ROOM";
  const note = clean(raw.note, 100) || null;
  return prisma.facility.upsert({ where: { companyId_name: { companyId: user.companyId, name } }, create: { companyId: user.companyId, name, kind, note }, update: { kind, note, active: true } });
}

export async function removeFacility(user: { companyId: string; role: string }, id: string) {
  if (user.role === "EMPLOYEE" || user.role === "ADVISOR") throw new UserError("予約できるものの削除は管理者・経理担当ができます");
  const { count } = await prisma.facility.updateMany({ where: { id, companyId: user.companyId }, data: { active: false } });
  if (!count) throw new UserError("見つかりません");
}

export async function listBookings(companyId: string, from: string, days = 7) {
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return prisma.booking.findMany({ where: { companyId, date: { gte: from, lte: to }, facility: { active: true } }, orderBy: [{ date: "asc" }, { start: "asc" }], include: { facility: { select: { name: true, kind: true } } } });
}

// 1行の予約の文を読む(何も保存しない)。施設の名前・日付・時刻・用件に分ける
export async function parseBooking(companyId: string, text: string) {
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) throw new UserError("予約の内容を書いてください");
  const today = jstDateKey(new Date());
  const facilities = await listFacilities(companyId);
  const flat = normalizeName(t);
  const facility =
    facilities.filter((f) => flat.includes(normalizeName(f.name))).sort((a, b) => b.name.length - a.name.length)[0] ??
    // 「会議室」「社用車」「車」とだけ書いてあり、その種類が1つだけなら
    (() => {
      const kind = /社用車|車/.test(t) ? "CAR" : /会議室|応接|ミーティングルーム/.test(t) ? "ROOM" : null;
      const same = kind ? facilities.filter((f) => f.kind === kind) : [];
      return same.length === 1 ? same[0] : null;
    })();
  const date = relativeDue(t, today) ?? today;
  const time = parseTimeRange(t);
  const title =
    t
      .replace(facility?.name ?? "\u0000", " ")
      // 長さ(「2時間」「90分」)を先に外す(時刻の読み取りで「間」だけ残らないように)
      .replace(/\d{1,2}\s*時間(半)?|\d{2,3}\s*分間?/g, " ")
      .replace(/(午前|午後)?\s*\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?)\s*(?:から|〜|~|-|ー|–)?\s*((午前|午後)?\s*\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?)\s*(まで)?)?/g, " ")
      .replace(/\d{1,2}\s*時間(半)?|\d{2,3}\s*分間?/g, " ")
      .replace(/今日|本日|明日|あした|明後日|あさって|(今週|来週|再来週)?の?\s*[月火水木金土日]曜日?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/g, " ")
      .replace(/(を|で|に)?\s*(予約|おさえ|押さえ)(して|したい|お願い|する)?.*$/, " ")
      // 「会議室」「社用車」とだけ書いた言葉は用件に入れない
      .replace(/(^|\s)(会議室|社用車|車|応接室)(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s、。,:の]+|[\s、。,:の]+$/g, "")
      .trim()
      .slice(0, 60) || "予約";
  return { facilityId: facility?.id ?? null, facilityName: facility?.name ?? null, date, start: time?.start ?? null, end: time?.end ?? null, title };
}

// 予約の注意(土日・祝日・会社の休業日・過去の日)
export async function bookingWarnings(companyId: string, date: string) {
  const today = jstDateKey(new Date());
  const out: string[] = [];
  if (date < today) out.push("過ぎた日の予約です");
  const reason = closedReason(date);
  if (reason) out.push(`${reason}です`);
  const closures = await closureMap(companyId, date);
  if (closures.has(date)) out.push(`会社の休業日(${closures.get(date)})です`);
  return out;
}

export async function createBooking(user: { id: string; companyId: string; name: string }, raw: Record<string, unknown>) {
  const facility = typeof raw.facilityId === "string" ? await prisma.facility.findFirst({ where: { id: raw.facilityId, companyId: user.companyId, active: true } }) : null;
  if (!facility) throw new UserError("予約するもの(会議室・社用車など)を選んでください");
  const date = String(raw.date ?? "");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("日付を正しく入れてください");
  if (!validHM(raw.start) || !validHM(raw.end)) throw new UserError("時刻を正しく入れてください(例: 14:00〜15:00)");
  if (raw.end <= raw.start) throw new UserError("終わりの時刻を始まりより後にしてください");
  const title = clean(raw.title, 60) || "予約";
  const slot = { start: raw.start, end: raw.end };
  const same = await prisma.booking.findMany({ where: { companyId: user.companyId, facilityId: facility.id, date } });
  const clash = same.find((b) => overlaps(b, slot));
  if (clash) throw new UserError(`${facility.name}は ${clash.start}〜${clash.end} に「${clash.title}」(${clash.userName})の予約があります`);
  const booking = await prisma.booking.create({ data: { companyId: user.companyId, facilityId: facility.id, date, start: slot.start, end: slot.end, title, userId: user.id, userName: user.name } });
  return { booking: { ...booking, facility: { name: facility.name, kind: facility.kind } }, warnings: await bookingWarnings(user.companyId, date) };
}

// 取り消しは予約した本人か、管理者・経理担当
export async function cancelBooking(user: { id: string; companyId: string; role: string }, id: string) {
  const b = await prisma.booking.findFirst({ where: { id, companyId: user.companyId } });
  if (!b) throw new UserError("予約が見つかりません");
  if (b.userId !== user.id && (user.role === "EMPLOYEE" || user.role === "ADVISOR")) throw new UserError("ほかの人の予約は取り消せません");
  await prisma.booking.delete({ where: { id } });
  return b;
}

export const kindLabel = (k: string) => FACILITY_KINDS[k as FacilityKind] ?? "そのほか";
