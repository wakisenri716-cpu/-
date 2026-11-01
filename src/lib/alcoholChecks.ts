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

// メーター(km)。空なら null
export function parseOdometer(v: unknown): number | null {
  const s = String(v ?? "").normalize("NFKC").replace(/[,\s]|km/gi, "");
  if (!s) return null;
  if (!/^\d{1,7}$/.test(s)) throw new UserError("メーターは km の数字で入れてください(例: 12345)");
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
  const odometer = parseOdometer(raw.odometer);
  // 帰着のメーターは、同じ予約(なければ同じ日・同じ車・同じ人)の出発のメーターより小さくできない
  if (timing === "AFTER" && odometer !== null) {
    const start = await prisma.alcoholCheck.findFirst({ where: { companyId: user.companyId, timing: "BEFORE", odometer: { not: null }, ...(bookingId ? { bookingId } : { date, vehicle, driverName }) }, orderBy: { checkedAt: "desc" } });
    if (start?.odometer != null && odometer < start.odometer) throw new UserError(`帰着のメーター(${odometer}km)が出発のメーター(${start.odometer}km)より小さくなっています`);
  }
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("日付を正しく入れてください");
  if (date > jstDateKey(new Date())) throw new UserError("先の日のチェックは記録できません");
  if (!driverName) throw new UserError("運転する人を入れてください");
  if (!vehicle) throw new UserError("車(名前かナンバー)を入れてください");
  return prisma.alcoholCheck.create({
    data: { companyId: user.companyId, date, timing, driverId, driverName, vehicle, bookingId, method, detected, value: value === null ? null : value.toFixed(2), checkerName: user.name, note: clean(raw.note, 200) || null, odometer, destination: clean(raw.destination, 60) || null },
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

// ---- 運転日誌 ----
// 運転前と運転後の記録を1回の運転としてまとめる(同じ予約、なければ同じ日・同じ車・同じ人の前→後の順)
type CheckRow = Awaited<ReturnType<typeof listChecks>>[number];
export function pairTrips(rows: CheckRow[]) {
  const sorted = [...rows].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
  const used = new Set<string>();
  const trips: { date: string; vehicle: string; driverName: string; start: Date | null; end: Date | null; odometerStart: number | null; odometerEnd: number | null; distance: number | null; destination: string | null; detected: boolean }[] = [];
  for (const before of sorted.filter((c) => c.timing === "BEFORE")) {
    const after = sorted.find((c) => !used.has(c.id) && c.timing === "AFTER" && c.checkedAt >= before.checkedAt && (before.bookingId ? c.bookingId === before.bookingId : !c.bookingId && c.date === before.date && c.vehicle === before.vehicle && c.driverName === before.driverName));
    if (after) used.add(after.id);
    const distance = before.odometer != null && after?.odometer != null ? after.odometer - before.odometer : null;
    trips.push({ date: before.date, vehicle: before.vehicle, driverName: before.driverName, start: before.checkedAt, end: after?.checkedAt ?? null, odometerStart: before.odometer, odometerEnd: after?.odometer ?? null, distance, destination: before.destination ?? after?.destination ?? null, detected: before.detected || !!after?.detected });
  }
  // 運転前の記録がない運転後
  for (const after of sorted.filter((c) => c.timing === "AFTER" && !used.has(c.id))) trips.push({ date: after.date, vehicle: after.vehicle, driverName: after.driverName, start: null, end: after.checkedAt, odometerStart: null, odometerEnd: after.odometer, distance: null, destination: after.destination, detected: after.detected });
  return trips.sort((a, b) => ((a.start ?? a.end)!.getTime() - (b.start ?? b.end)!.getTime()));
}

export function tripTotals(trips: ReturnType<typeof pairTrips>) {
  const map = new Map<string, { vehicle: string; trips: number; distance: number }>();
  for (const t of trips) {
    const v = map.get(t.vehicle) ?? { vehicle: t.vehicle, trips: 0, distance: 0 };
    v.trips++;
    v.distance += t.distance ?? 0;
    map.set(t.vehicle, v);
  }
  return [...map.values()].sort((a, b) => b.distance - a.distance);
}

// 車ごとの最後のメーター(次の出発のメーターの目安)
export async function lastOdometers(companyId: string) {
  const rows = await prisma.alcoholCheck.findMany({ where: { companyId, odometer: { not: null } }, orderBy: { checkedAt: "desc" }, select: { vehicle: true, odometer: true }, take: 500 });
  const out: Record<string, number> = {};
  for (const r of rows) if (!(r.vehicle in out) && r.odometer != null) out[r.vehicle] = r.odometer;
  return out;
}

export function tripsCsv(trips: ReturnType<typeof pairTrips>) {
  const time = (d: Date | null) => (d ? d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" }) : "");
  return [["日付", "車", "運転者", "出発", "帰着", "出発時のメーター(km)", "帰着時のメーター(km)", "走った距離(km)", "行き先", "酒気帯び"], ...trips.map((t) => [t.date, t.vehicle, t.driverName, time(t.start), time(t.end), t.odometerStart ?? "", t.odometerEnd ?? "", t.distance ?? "", t.destination ?? "", t.detected ? "あり" : "なし"])];
}
