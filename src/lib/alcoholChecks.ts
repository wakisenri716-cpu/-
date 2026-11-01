import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { memoContext } from "@/lib/phoneMemos";

// 社用車のアルコールチェック: 運転の前と後に、運転する人が酒気を帯びていないかを確かめて記録する(記録は1年間残す)。
// 社用車の予約から1回の操作で記録でき、予約があるのに記録がないものはやることリストで知らせる。

export const TIMINGS = { BEFORE: "運転前", AFTER: "運転後" } as const;
export const METHODS = { FACE: "対面", VIDEO: "カメラ・ビデオ通話", PHONE: "電話" } as const;
export type Timing = keyof typeof TIMINGS;
export type Method = keyof typeof METHODS;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nowHM = () => new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });

// 検知器の数値(mg/L)。空なら null、読めなければ間違い
export function parseValue(v: unknown): number | null {
  const s = String(v ?? "").normalize("NFKC").replace(/mg\/?l/i, "").trim();
  if (!s) return null;
  if (!/^\d(\.\d{1,3})?$/.test(s)) throw new UserError("検知器の数値は 0.00 のように入れてください(mg/L)");
  return Number(s);
}

export async function recordCheck(user: { companyId: string; name: string }, raw: Record<string, unknown>) {
  const timing: Timing = raw.timing === "AFTER" ? "AFTER" : "BEFORE";
  const method: Method = raw.method === "VIDEO" || raw.method === "PHONE" ? raw.method : "FACE";
  const value = parseValue(raw.value);
  // 数値が0より大きいときは「酒気帯びあり」として記録する
  const detected = raw.detected === true || (value !== null && value > 0);
  let date = String(raw.date ?? "") || jstDateKey(new Date());
  let driverId: string | null = null;
  let driverName = clean(raw.driverName, 40);
  let vehicle = clean(raw.vehicle, 60);
  let bookingId: string | null = null;
  if (typeof raw.bookingId === "string" && raw.bookingId) {
    const b = await prisma.booking.findFirst({ where: { id: raw.bookingId, companyId: user.companyId }, include: { facility: { select: { name: true } } } });
    if (!b) throw new UserError("社用車の予約が見つかりません");
    bookingId = b.id;
    date = b.date;
    vehicle ||= b.facility.name;
    if (!driverName && !raw.driverId) {
      driverId = b.userId;
      driverName = b.userName;
    }
  }
  if (typeof raw.driverId === "string" && raw.driverId) {
    const ctx = await memoContext(user.companyId);
    const m = ctx.users.find((u) => u.id === raw.driverId);
    if (!m) throw new UserError("運転する人が見つかりません");
    driverId = m.id;
    driverName = m.name;
  }
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("日付を正しく入れてください");
  if (date > jstDateKey(new Date())) throw new UserError("先の日のチェックは記録できません");
  if (!driverName) throw new UserError("運転する人を入れてください");
  if (!vehicle) throw new UserError("車(名前かナンバー)を入れてください");
  return prisma.alcoholCheck.create({
    data: { companyId: user.companyId, date, timing, driverId, driverName, vehicle, bookingId, method, detected, value: value === null ? null : value.toFixed(2), checkerName: user.name, note: clean(raw.note, 200) || null },
  });
}

// ある日の社用車の予約と、それぞれの運転前・運転後の記録
export async function carBookingsOn(companyId: string, date: string) {
  const bookings = await prisma.booking.findMany({ where: { companyId, date, facility: { kind: "CAR", active: true } }, include: { facility: { select: { name: true } } }, orderBy: { start: "asc" } });
  const checks = bookings.length ? await prisma.alcoholCheck.findMany({ where: { companyId, bookingId: { in: bookings.map((b) => b.id) } }, orderBy: { checkedAt: "asc" } }) : [];
  return bookings.map((b) => ({
    id: b.id,
    date: b.date,
    start: b.start,
    end: b.end,
    vehicle: b.facility.name,
    driverName: b.userName,
    title: b.title,
    before: checks.find((c) => c.bookingId === b.id && c.timing === "BEFORE") ?? null,
    after: checks.find((c) => c.bookingId === b.id && c.timing === "AFTER") ?? null,
  }));
}

export async function listChecks(companyId: string, from: string, to: string) {
  return prisma.alcoholCheck.findMany({ where: { companyId, date: { gte: from, lte: to } }, orderBy: [{ date: "desc" }, { checkedAt: "desc" }], take: 1000 });
}

// 記録が足りない社用車の予約(この7日。今日の分は、始まり・終わりの時刻を過ぎたものだけ)
export async function missingChecks(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const hm = nowHM();
  const out: { bookingId: string; date: string; vehicle: string; driverName: string; start: string; end: string; missing: Timing[] }[] = [];
  for (let d = addDays(today, -6); d <= today; d = addDays(d, 1)) {
    for (const b of await carBookingsOn(companyId, d)) {
      const missing: Timing[] = [];
      if (!b.before && (d < today || b.start <= hm)) missing.push("BEFORE");
      if (!b.after && (d < today || b.end <= hm)) missing.push("AFTER");
      if (missing.length) out.push({ bookingId: b.id, date: d, vehicle: b.vehicle, driverName: b.driverName, start: b.start, end: b.end, missing });
    }
  }
  return out;
}

export async function countMissingChecks(companyId: string) {
  return (await missingChecks(companyId)).length;
}

export function checksCsv(rows: Awaited<ReturnType<typeof listChecks>>) {
  const time = (d: Date) => d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" });
  return [
    ["日付", "時刻", "運転前・後", "運転者", "車", "確認の方法", "酒気帯び", "検知器の数値(mg/L)", "確認者", "メモ"],
    ...[...rows].reverse().map((c) => [c.date, time(c.checkedAt), TIMINGS[c.timing as Timing] ?? c.timing, c.driverName, c.vehicle, METHODS[c.method as Method] ?? c.method, c.detected ? "あり" : "なし", c.value ?? "", c.checkerName, c.note ?? ""]),
  ];
}
