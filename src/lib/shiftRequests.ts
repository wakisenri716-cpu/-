import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { parseTime } from "@/lib/shifts/pay";

// シフト希望: スタッフがスマホで「出勤できる日と時間」「休みたい日」を出し、管理者がそれを見てシフトを作る

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAYS = "日月火水木金土";

export function addMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] };
  });
}

export function monthDateRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// 締め切り(前月の何日まで)を過ぎたか
function deadlineOf(month: string, deadlineDay: number | null) {
  if (!deadlineDay) return null;
  const prev = addMonth(month, -1);
  const [y, m] = prev.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${prev}-${String(Math.min(deadlineDay, last)).padStart(2, "0")}`;
}

export function parseMonth(value: unknown, fallback: string) {
  const v = String(value ?? "");
  return MONTH.test(v) ? v : fallback;
}

async function staffOf(companyId: string, userId: string) {
  return prisma.staff.findFirst({ where: { companyId, userId, active: true } });
}

// 自分のシフト希望と、決まったシフト(1か月分)
export async function myShiftMonth(companyId: string, userId: string, monthValue: unknown, now = new Date()) {
  const today = jstDateKey(now);
  const month = parseMonth(monthValue, addMonth(today.slice(0, 7), 1));
  const [staff, company] = await Promise.all([staffOf(companyId, userId), prisma.company.findUnique({ where: { id: companyId }, select: { shiftRequestDeadline: true } })]);
  const deadline = deadlineOf(month, company?.shiftRequestDeadline ?? null);
  const base = { month, today, deadline, locked: !!deadline && today > deadline, staff: staff ? { id: staff.id, name: staff.name } : null };
  if (!staff) return { ...base, days: [] };
  const [requests, shifts] = await Promise.all([
    prisma.shiftRequest.findMany({ where: { staffId: staff.id, date: monthDateRange(month) } }),
    prisma.shift.findMany({ where: { staffId: staff.id, date: monthDateRange(month) }, orderBy: { startMinutes: "asc" } }),
  ]);
  const reqBy = new Map(requests.map((r) => [jstDateKey(r.date), r]));
  return {
    ...base,
    days: daysOf(month).map((d) => {
      const r = reqBy.get(d.date);
      return {
        ...d,
        request: r ? { available: r.available, start: r.startMinutes === null ? null : hhmm(r.startMinutes), end: r.endMinutes === null ? null : hhmm(r.endMinutes), note: r.note } : null,
        shifts: shifts.filter((s) => jstDateKey(s.date) === d.date).map((s) => ({ start: hhmm(s.startMinutes), end: hhmm(s.endMinutes), breakMinutes: s.breakMinutes, note: s.note })),
      };
    }),
  };
}

type DayInput = { date?: unknown; status?: unknown; start?: unknown; end?: unknown; note?: unknown };

// 1か月分の希望をまとめて保存する。status: "available"(出勤できる)/ "off"(休みたい)/ ""(未定=消す)
export async function saveMyShiftMonth(companyId: string, userId: string, monthValue: unknown, items: unknown, now = new Date()) {
  const today = jstDateKey(now);
  const month = String(monthValue ?? "");
  if (!MONTH.test(month)) throw new UserError("月を正しく指定してください");
  const staff = await staffOf(companyId, userId);
  if (!staff) throw new UserError("スタッフとして登録されていません。管理者に「シフト管理」でのスタッフ登録と、アカウントのひも付けを頼んでください");
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { shiftRequestDeadline: true } });
  const deadline = deadlineOf(month, company?.shiftRequestDeadline ?? null);
  if (deadline && today > deadline) throw new UserError(`${Number(month.slice(5))}月のシフト希望の締め切り(${deadline.replaceAll("-", "/")})を過ぎています。変えたいときは管理者に伝えてください`);
  if (month < today.slice(0, 7)) throw new UserError("過ぎた月の希望は出せません");
  if (!Array.isArray(items)) throw new UserError("希望の内容が正しくありません");
  const valid = new Set(daysOf(month).map((d) => d.date));
  const rows: { date: string; available: boolean; startMinutes: number | null; endMinutes: number | null; note: string | null }[] = [];
  const clear: string[] = [];
  for (const raw of items as DayInput[]) {
    const date = String(raw?.date ?? "");
    if (!valid.has(date)) throw new UserError("日付が正しくありません");
    const status = String(raw?.status ?? "");
    const note = String(raw?.note ?? "").trim().slice(0, 100) || null;
    if (!status) {
      clear.push(date);
      continue;
    }
    if (status === "off") {
      rows.push({ date, available: false, startMinutes: null, endMinutes: null, note });
      continue;
    }
    if (status !== "available") throw new UserError("希望の種類が正しくありません");
    // 時間は空でもよい(「何時でも可」)
    const startText = String(raw?.start ?? "").trim();
    const endText = String(raw?.end ?? "").trim();
    let start: number | null = null;
    let end: number | null = null;
    if (startText || endText) {
      start = parseTime(startText);
      end = parseTime(endText);
      if (start === null || end === null) throw new UserError(`${Number(date.slice(8))}日の時間を「9:00」の形で入力してください`);
      if (end <= start) end += 1440;
      if (end - start > 16 * 60) throw new UserError(`${Number(date.slice(8))}日の時間が長すぎます(16時間まで)`);
    }
    rows.push({ date, available: true, startMinutes: start, endMinutes: end, note });
  }
  await prisma.$transaction(async (tx) => {
    if (clear.length) await tx.shiftRequest.deleteMany({ where: { staffId: staff.id, date: { in: clear.map((d) => new Date(`${d}T00:00:00Z`)) } } });
    for (const r of rows) {
      const date = new Date(`${r.date}T00:00:00Z`);
      const data = { available: r.available, startMinutes: r.startMinutes, endMinutes: r.endMinutes, note: r.note };
      await tx.shiftRequest.upsert({ where: { staffId_date: { staffId: staff.id, date } }, create: { companyId, staffId: staff.id, date, ...data }, update: data });
    }
  });
  return { staff, month, saved: rows.length, cleared: clear.length };
}

// これからのシフト(ホーム画面用)
export async function myUpcomingShifts(companyId: string, userId: string, now = new Date(), limit = 5) {
  const staff = await staffOf(companyId, userId);
  if (!staff) return { staff: null, shifts: [] };
  const today = jstDateKey(now);
  const shifts = await prisma.shift.findMany({ where: { staffId: staff.id, date: { gte: new Date(`${today}T00:00:00Z`) } }, orderBy: [{ date: "asc" }, { startMinutes: "asc" }], take: limit });
  return {
    staff: { id: staff.id, name: staff.name },
    shifts: shifts.map((s) => {
      const date = jstDateKey(s.date);
      return { date, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()], start: hhmm(s.startMinutes), end: hhmm(s.endMinutes), breakMinutes: s.breakMinutes, today: date === today };
    }),
  };
}

// ---- 管理者 ----

// 1か月分の、スタッフ × 日の希望と決まったシフト
export async function getRequestBoard(companyId: string, monthValue: unknown, now = new Date()) {
  const today = jstDateKey(now);
  const month = parseMonth(monthValue, addMonth(today.slice(0, 7), 1));
  const [staff, requests, shifts, company] = await Promise.all([
    prisma.staff.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, userId: true } }),
    prisma.shiftRequest.findMany({ where: { companyId, date: monthDateRange(month) } }),
    prisma.shift.findMany({ where: { companyId, date: monthDateRange(month) }, select: { staffId: true, date: true, startMinutes: true, endMinutes: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { shiftRequestDeadline: true } }),
  ]);
  const key = (staffId: string, date: string) => `${staffId}:${date}`;
  const reqBy = new Map(requests.map((r) => [key(r.staffId, jstDateKey(r.date)), r]));
  const shiftBy = new Map<string, { start: string; end: string }[]>();
  for (const s of shifts) {
    const k = key(s.staffId, jstDateKey(s.date));
    shiftBy.set(k, [...(shiftBy.get(k) ?? []), { start: hhmm(s.startMinutes), end: hhmm(s.endMinutes) }]);
  }
  const days = daysOf(month);
  return {
    month,
    deadlineDay: company?.shiftRequestDeadline ?? null,
    deadline: deadlineOf(month, company?.shiftRequestDeadline ?? null),
    days,
    staff: staff.map((s) => {
      const cells = days.map((d) => {
        const r = reqBy.get(key(s.id, d.date));
        return {
          date: d.date,
          request: r ? { available: r.available, start: r.startMinutes === null ? null : hhmm(r.startMinutes), end: r.endMinutes === null ? null : hhmm(r.endMinutes), note: r.note } : null,
          shifts: shiftBy.get(key(s.id, d.date)) ?? [],
        };
      });
      return {
        id: s.id,
        name: s.name,
        linked: !!s.userId,
        submitted: cells.filter((c) => c.request).length,
        available: cells.filter((c) => c.request?.available).length,
        off: cells.filter((c) => c.request && !c.request.available).length,
        cells,
      };
    }),
  };
}

// 休憩の目安: 6時間を超えたら45分、8時間を超えたら60分(労働基準法の最低限)
export function breakFor(minutes: number) {
  if (minutes > 8 * 60) return 60;
  if (minutes > 6 * 60) return 45;
  return 0;
}

// 「出勤できる」で時間のある希望から、まだシフトがない日のシフトを作る
export async function applyRequests(companyId: string, monthValue: unknown, staffId?: string) {
  const month = String(monthValue ?? "");
  if (!MONTH.test(month)) throw new UserError("月を正しく指定してください");
  const requests = await prisma.shiftRequest.findMany({
    where: { companyId, date: monthDateRange(month), available: true, startMinutes: { not: null }, endMinutes: { not: null }, ...(staffId ? { staffId } : {}), staff: { active: true } },
  });
  const existing = await prisma.shift.findMany({ where: { companyId, date: monthDateRange(month), ...(staffId ? { staffId } : {}) }, select: { staffId: true, date: true } });
  const has = new Set(existing.map((s) => `${s.staffId}:${jstDateKey(s.date)}`));
  const create = requests
    .filter((r) => !has.has(`${r.staffId}:${jstDateKey(r.date)}`))
    .map((r) => ({ companyId, staffId: r.staffId, date: r.date, startMinutes: r.startMinutes!, endMinutes: r.endMinutes!, breakMinutes: breakFor(r.endMinutes! - r.startMinutes!), note: r.note }));
  if (create.length) await prisma.shift.createMany({ data: create });
  return { month, created: create.length, skipped: requests.length - create.length, shifts: create };
}

export async function setDeadline(companyId: string, value: unknown) {
  const raw = String(value ?? "").trim();
  const day = raw === "" ? null : Number(raw);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) throw new UserError("締め切りは1〜31日で選んでください");
  await prisma.company.update({ where: { id: companyId }, data: { shiftRequestDeadline: day } });
  return day;
}
