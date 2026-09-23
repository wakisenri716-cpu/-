import { prisma } from "@/lib/prisma";
import type { TimeRecord } from "@prisma/client";
import { jstDateKey, jstMidnight } from "@/lib/jst";
import { parseTime } from "@/lib/shifts/pay";
import { dateKey, mondayOf } from "@/lib/shifts/service";
import { minutesFromWorkDay, recordTimes } from "./times";

export class AttendanceError extends Error {}

// これより長く出勤中のままの記録は、退勤の押し忘れとして扱う
const MAX_OPEN_MS = 16 * 60 * 60 * 1000;

export type PunchAction = "in" | "breakStart" | "breakEnd" | "out";

function workDate(key: string) {
  return new Date(`${key}T00:00:00Z`);
}

function minutesBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

async function openRecord(staffId: string) {
  return prisma.timeRecord.findFirst({ where: { staffId, clockOut: null }, orderBy: { clockIn: "desc" } });
}

function isStale(record: TimeRecord, now: Date) {
  return now.getTime() - record.clockIn.getTime() > MAX_OPEN_MS;
}

function staleMessage(record: TimeRecord) {
  const [, m, d] = dateKey(record.date).split("-").map(Number);
  return `前回(${m}月${d}日)の退勤が打刻されていません。管理者に「勤怠一覧」から修正してもらってください`;
}

export async function punch(companyId: string, staffId: string, action: PunchAction, now = new Date()) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId, active: true } });
  if (!staff) throw new AttendanceError("スタッフが見つかりません");
  const open = await openRecord(staffId);
  const current = open && !isStale(open, now) ? open : null;

  // 同時に2回押されても二重に記録されないよう、状態を条件にして更新する
  const update = async (where: object, data: object) => {
    const result = await prisma.timeRecord.updateMany({ where: { id: current!.id, clockOut: null, ...where }, data });
    if (result.count !== 1) throw new AttendanceError("状態が変わりました。画面を更新してもう一度押してください");
  };

  switch (action) {
    case "in":
      if (current) throw new AttendanceError(`${staff.name}さんはすでに出勤中です`);
      return prisma.timeRecord.create({
        data: { companyId, staffId, date: workDate(jstDateKey(now)), clockIn: now },
      });
    case "breakStart":
      if (!current) throw new AttendanceError(open ? staleMessage(open) : "出勤していません");
      if (current.breakStartedAt) throw new AttendanceError("すでに休憩中です");
      return update({ breakStartedAt: null }, { breakStartedAt: now });
    case "breakEnd":
      if (!current?.breakStartedAt) throw new AttendanceError("休憩中ではありません");
      return update(
        { breakStartedAt: current.breakStartedAt },
        { breakStartedAt: null, breakMinutes: current.breakMinutes + minutesBetween(current.breakStartedAt, now) },
      );
    case "out": {
      if (!current) throw new AttendanceError(open ? staleMessage(open) : "出勤していません");
      const breakMinutes = current.breakMinutes + (current.breakStartedAt ? minutesBetween(current.breakStartedAt, now) : 0);
      return update({}, { clockOut: now, breakStartedAt: null, breakMinutes });
    }
  }
}

// 打刻画面用: 在籍スタッフの今の状態と、今日の予定・実績
export async function getBoard(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const [staff, open, todayRecords, todayShifts] = await Promise.all([
    prisma.staff.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.timeRecord.findMany({ where: { companyId, clockOut: null }, orderBy: { clockIn: "desc" } }),
    prisma.timeRecord.findMany({ where: { companyId, date: workDate(today) }, orderBy: { clockIn: "asc" } }),
    prisma.shift.findMany({ where: { companyId, date: workDate(today) }, orderBy: { startMinutes: "asc" } }),
  ]);

  return {
    today,
    staff: staff.map((s) => {
      const record = open.find((r) => r.staffId === s.id);
      const stale = record ? isStale(record, now) : false;
      const status = !record || stale ? "off" : record.breakStartedAt ? "break" : "working";
      const worked = todayRecords
        .filter((r) => r.staffId === s.id && r.clockOut)
        .reduce((sum, r) => {
          const t = recordTimes(r);
          return sum + t.endMinutes - t.startMinutes - t.breakMinutes;
        }, 0);
      return {
        id: s.id,
        name: s.name,
        status,
        since: status === "break" ? record!.breakStartedAt : status === "working" ? record!.clockIn : null,
        forgotClockOut: stale ? dateKey(record!.date) : null,
        workedMinutesToday: worked,
        plans: todayShifts
          .filter((sh) => sh.staffId === s.id)
          .map((sh) => ({ startMinutes: sh.startMinutes, endMinutes: sh.endMinutes })),
      };
    }),
  };
}

// 勤怠一覧用: 週のシフト予定と打刻実績をスタッフ×日で並べる
export async function getAttendanceWeek(companyId: string, week: string, now = new Date()) {
  const monday = mondayOf(week);
  const days = Array.from({ length: 7 }, (_, i) => dateKey(new Date(monday.getTime() + i * 86_400_000)));
  const range = { gte: monday, lt: new Date(monday.getTime() + 7 * 86_400_000) };
  const [shifts, records] = await Promise.all([
    prisma.shift.findMany({ where: { companyId, date: range }, orderBy: { startMinutes: "asc" } }),
    prisma.timeRecord.findMany({ where: { companyId, date: range }, orderBy: { clockIn: "asc" } }),
  ]);
  const staffIds = [...new Set([...shifts.map((s) => s.staffId), ...records.map((r) => r.staffId)])];
  const staff = await prisma.staff.findMany({
    where: { companyId, OR: [{ active: true }, { id: { in: staffIds } }] },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });

  return {
    weekStart: days[0],
    days,
    today: jstDateKey(now),
    staff: staff.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    plans: shifts.map((s) => ({
      staffId: s.staffId,
      date: dateKey(s.date),
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
      breakMinutes: s.breakMinutes,
    })),
    records: records.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      date: dateKey(r.date),
      startMinutes: minutesFromWorkDay(r.date, r.clockIn),
      endMinutes: r.clockOut ? minutesFromWorkDay(r.date, r.clockOut) : null,
      breakMinutes: r.breakMinutes,
      onBreak: !!r.breakStartedAt,
      forgotClockOut: !r.clockOut && isStale(r, now),
      edited: r.edited,
    })),
  };
}

export type RecordInput = { staffId: string; date: string; start: string; end: string; breakMinutes: number };

async function toRecordData(companyId: string, input: RecordInput) {
  const staff = await prisma.staff.findFirst({ where: { id: input.staffId, companyId } });
  if (!staff) throw new AttendanceError("スタッフを選択してください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || dateKey(workDate(input.date)) !== input.date) {
    throw new AttendanceError("日付が正しくありません");
  }
  const start = parseTime(input.start);
  if (start === null) throw new AttendanceError("出勤時刻を正しく入力してください");
  const midnight = jstMidnight(input.date).getTime();
  let clockOut: Date | null = null;
  if (input.end) {
    let end = parseTime(input.end);
    if (end === null) throw new AttendanceError("退勤時刻を正しく入力してください");
    if (end <= start) end += 1440;
    if (end - start > 16 * 60) throw new AttendanceError("1回の勤務は16時間までです");
    if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes >= end - start) {
      throw new AttendanceError("休憩時間は勤務時間より短い0以上の分数で入力してください");
    }
    clockOut = new Date(midnight + end * 60_000);
  }
  return {
    companyId,
    staffId: staff.id,
    date: workDate(input.date),
    clockIn: new Date(midnight + start * 60_000),
    clockOut,
    breakMinutes: input.breakMinutes,
    breakStartedAt: null,
    edited: true,
  };
}

export async function saveRecord(companyId: string, id: string | null, input: RecordInput) {
  const data = await toRecordData(companyId, input);
  if (!id) return prisma.timeRecord.create({ data });
  const existing = await prisma.timeRecord.findFirst({ where: { id, companyId } });
  if (!existing) throw new AttendanceError("打刻の記録が見つかりません");
  return prisma.timeRecord.update({ where: { id }, data });
}

export async function deleteRecord(companyId: string, id: string) {
  const existing = await prisma.timeRecord.findFirst({ where: { id, companyId } });
  if (!existing) throw new AttendanceError("打刻の記録が見つかりません");
  await prisma.timeRecord.delete({ where: { id } });
}
