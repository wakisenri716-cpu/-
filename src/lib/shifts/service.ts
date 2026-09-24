import { prisma } from "@/lib/prisma";
import type { Shift, Staff } from "@prisma/client";
import { ensureAccount } from "@/lib/accounting/accounts";
import { hashPassword } from "@/lib/auth/password";
import { recordTimes } from "@/lib/attendance/times";
import { addPay, dailyPay, EMPTY_PAY, parseTime, roundPay, type PayBreakdown, type ShiftTimes } from "./pay";
import { UserError } from "@/lib/errors";

export class ShiftError extends UserError {}

const SALARY_ACCOUNT = "5110"; // 給料手当
const ACCRUED_ACCOUNT = "2020"; // 未払金
const MAX_SHIFT_MINUTES = 16 * 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDate(key: string): Date {
  if (!DATE.test(key)) throw new ShiftError("日付が正しくありません");
  const d = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || dateKey(d) !== key) throw new ShiftError("日付が正しくありません");
  return d;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function mondayOf(key: string): Date {
  const d = toDate(key);
  return addDays(d, -((d.getUTCDay() + 6) % 7));
}

function monthRange(month: string) {
  if (!MONTH.test(month)) throw new ShiftError("月の指定が正しくありません");
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

// ---- スタッフ ----

// 画面に返すスタッフ情報。暗証番号のハッシュや失敗回数は外に出さず、設定済みかどうかだけ返す。
export function publicStaff(s: Staff) {
  return { id: s.id, name: s.name, hourlyWage: s.hourlyWage, active: s.active, createdAt: s.createdAt, hasPin: s.pinHash !== null };
}

const PIN = /^\d{4}$/;

function validWage(wage: number) {
  if (!Number.isInteger(wage) || wage <= 0 || wage > 100_000) throw new ShiftError("時給を正しく入力してください");
}

export async function createStaff(companyId: string, input: { name: string; hourlyWage: number }) {
  const name = input.name.trim();
  if (!name) throw new ShiftError("名前を入力してください");
  validWage(input.hourlyWage);
  try {
    return publicStaff(await prisma.staff.create({ data: { companyId, name, hourlyWage: input.hourlyWage } }));
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ShiftError(`「${name}」はすでに登録されています`);
    throw error;
  }
}

// pin: 4桁の数字で設定、null で解除、undefined なら変更しない
export async function updateStaff(companyId: string, id: string, input: { hourlyWage?: number; active?: boolean; pin?: string | null }) {
  const staff = await prisma.staff.findFirst({ where: { id, companyId } });
  if (!staff) throw new ShiftError("スタッフが見つかりません");
  if (input.hourlyWage !== undefined) validWage(input.hourlyWage);
  const { pin, ...rest } = input;
  if (pin != null && !PIN.test(pin)) throw new ShiftError("暗証番号は4桁の数字で入力してください");
  const pinData = pin === undefined ? {} : { pinHash: pin === null ? null : await hashPassword(pin), pinFailures: 0, pinLockedUntil: null };
  return publicStaff(await prisma.staff.update({ where: { id }, data: { ...rest, ...pinData } }));
}

// ---- シフト ----

export type ShiftInput = { staffId: string; date: string; start: string; end: string; breakMinutes: number; note?: string | null };

async function validateShift(companyId: string, input: ShiftInput) {
  const staff = await prisma.staff.findFirst({ where: { id: input.staffId, companyId } });
  if (!staff) throw new ShiftError("スタッフを選択してください");
  if (!staff.active) throw new ShiftError(`${staff.name}さんは在籍していない設定になっています`);
  const date = toDate(input.date);
  const start = parseTime(input.start);
  let end = parseTime(input.end);
  if (start === null || end === null) throw new ShiftError("開始・終了時刻を正しく入力してください");
  // 終了が開始以前なら日付をまたぐ勤務(例: 22:00〜翌5:00)とみなす
  if (end <= start) end += 1440;
  const span = end - start;
  if (span > MAX_SHIFT_MINUTES) throw new ShiftError("1回のシフトは16時間までです");
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes >= span) {
    throw new ShiftError("休憩時間は勤務時間より短い0以上の分数で入力してください");
  }
  return {
    companyId,
    staffId: staff.id,
    date,
    startMinutes: start,
    endMinutes: end,
    breakMinutes: input.breakMinutes,
    note: input.note?.trim() || null,
  };
}

export async function createShift(companyId: string, input: ShiftInput) {
  return prisma.shift.create({ data: await validateShift(companyId, input) });
}

export async function updateShift(companyId: string, id: string, input: ShiftInput) {
  const existing = await prisma.shift.findFirst({ where: { id, companyId } });
  if (!existing) throw new ShiftError("シフトが見つかりません");
  return prisma.shift.update({ where: { id }, data: await validateShift(companyId, input) });
}

export async function deleteShift(companyId: string, id: string) {
  const existing = await prisma.shift.findFirst({ where: { id, companyId } });
  if (!existing) throw new ShiftError("シフトが見つかりません");
  await prisma.shift.delete({ where: { id } });
}

// 前の週のシフトを今週の同じ曜日へ写す。すでにその日にシフトがあるスタッフの分は写さない。
export async function copyPreviousWeek(companyId: string, weekStart: string) {
  const monday = mondayOf(weekStart);
  const previous = await prisma.shift.findMany({
    where: { companyId, date: { gte: addDays(monday, -7), lt: monday }, staff: { active: true } },
  });
  const existing = await prisma.shift.findMany({
    where: { companyId, date: { gte: monday, lt: addDays(monday, 7) } },
    select: { staffId: true, date: true },
  });
  const taken = new Set(existing.map((s) => `${s.staffId}|${dateKey(s.date)}`));
  const data = previous
    .map((s) => ({ ...s, date: addDays(s.date, 7) }))
    .filter((s) => !taken.has(`${s.staffId}|${dateKey(s.date)}`))
    .map(({ staffId, date, startMinutes, endMinutes, breakMinutes, note }) => ({
      companyId,
      staffId,
      date,
      startMinutes,
      endMinutes,
      breakMinutes,
      note,
    }));
  if (data.length > 0) await prisma.shift.createMany({ data });
  return { copied: data.length, skipped: previous.length - data.length };
}

// ---- 集計 ----

type StaffDay = { staff: Staff; date: string; times: ShiftTimes[] };

function groupShifts(shifts: (Shift & { staff: Staff })[]): Map<string, StaffDay> {
  const days = new Map<string, StaffDay>();
  for (const s of shifts) {
    const key = `${s.staffId}|${dateKey(s.date)}`;
    const day = days.get(key) ?? { staff: s.staff, date: dateKey(s.date), times: [] };
    day.times.push(s);
    days.set(key, day);
  }
  return days;
}

// スタッフ×日ごとに割増を計算し、合計してから円単位に丸める
function summarize(days: Iterable<StaffDay>) {
  const perStaff = new Map<string, PayBreakdown>();
  const perDay = new Map<string, PayBreakdown & { people: Set<string> }>();
  for (const { staff, date, times } of days) {
    const pay = dailyPay(times, staff.hourlyWage);
    perStaff.set(staff.id, addPay(perStaff.get(staff.id) ?? EMPTY_PAY, pay));
    const day = perDay.get(date) ?? { ...EMPTY_PAY, people: new Set<string>() };
    day.people.add(staff.id);
    perDay.set(date, { ...addPay(day, pay), people: day.people });
  }
  return { perStaff, perDay };
}

export async function getWeek(companyId: string, weekStart: string) {
  const monday = mondayOf(weekStart);
  const days = Array.from({ length: 7 }, (_, i) => dateKey(addDays(monday, i)));
  const shifts = await prisma.shift.findMany({
    where: { companyId, date: { gte: monday, lt: addDays(monday, 7) } },
    include: { staff: true },
    orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
  });
  const staff = await prisma.staff.findMany({
    where: { companyId, OR: [{ active: true }, { id: { in: shifts.map((s) => s.staffId) } }] },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  const { perStaff, perDay } = summarize(groupShifts(shifts).values());
  return {
    weekStart: days[0],
    days,
    staff: staff.map((s) => ({ ...publicStaff(s), week: roundPay(perStaff.get(s.id) ?? EMPTY_PAY) })),
    shifts: shifts.map((s) => ({
      id: s.id,
      staffId: s.staffId,
      date: dateKey(s.date),
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
      breakMinutes: s.breakMinutes,
      note: s.note,
    })),
    daily: days.map((d) => {
      const day = perDay.get(d);
      const { people, ...pay } = day ?? { ...EMPTY_PAY, people: new Set<string>() };
      return { date: d, ...roundPay(pay), people: people.size };
    }),
  };
}

// 退勤まで打刻された日は打刻の実績で、打刻のない日はシフトの予定で人件費を計算する
export async function getMonthlyPayroll(companyId: string, month: string) {
  const range = monthRange(month);
  const [shifts, records] = await Promise.all([
    prisma.shift.findMany({ where: { companyId, date: range }, include: { staff: true } }),
    prisma.timeRecord.findMany({ where: { companyId, date: range, clockOut: { not: null } }, include: { staff: true } }),
  ]);
  const days = groupShifts(shifts);
  const actualKeys = new Set<string>();
  for (const r of records) {
    const key = `${r.staffId}|${dateKey(r.date)}`;
    if (!actualKeys.has(key)) {
      actualKeys.add(key);
      days.set(key, { staff: r.staff, date: dateKey(r.date), times: [] });
    }
    days.get(key)!.times.push(recordTimes(r));
  }
  const { perStaff } = summarize(days.values());
  const countDays = (staffId: string, actual: boolean) =>
    [...days.keys()].filter((k) => k.startsWith(`${staffId}|`) && actualKeys.has(k) === actual).length;

  const staff = await prisma.staff.findMany({ where: { id: { in: [...perStaff.keys()] } }, orderBy: { createdAt: "asc" } });
  const rows = staff.map((s) => ({
    staffId: s.id,
    name: s.name,
    hourlyWage: s.hourlyWage,
    actualDays: countDays(s.id, true),
    plannedDays: countDays(s.id, false),
    ...roundPay(perStaff.get(s.id)!),
  }));
  const run = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } });
  return { month, rows, total: rows.reduce((sum, r) => sum + r.total, 0), run };
}

export async function postPayroll(companyId: string, month: string) {
  const { rows, total, run } = await getMonthlyPayroll(companyId, month);
  if (run) throw new ShiftError("この月の給料はすでに計上しています");
  if (total <= 0) throw new ShiftError("この月のシフトがないため計上できません");
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0));

  try {
    return await prisma.$transaction(async (tx) => {
      const [salary, accrued] = await Promise.all([
        ensureAccount(tx, companyId, SALARY_ACCOUNT),
        ensureAccount(tx, companyId, ACCRUED_ACCOUNT),
      ]);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: lastDay,
          description: `給料計上 ${y}年${m}月分(シフトより ${rows.length}名)`,
          sourceType: "PAYROLL",
          status: "AUTO_POSTED",
          createdByAi: false,
          lines: {
            create: [
              { accountId: salary.id, debit: total, credit: 0, memo: "シフトから計算した総支給額" },
              { accountId: accrued.id, debit: 0, credit: total, memo: "給料の未払い分" },
            ],
          },
        },
      });
      return tx.payrollRun.create({ data: { companyId, month, totalAmount: total, journalEntryId: entry.id } });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ShiftError("この月の給料はすでに計上しています");
    throw error;
  }
}

export async function voidPayroll(companyId: string, month: string) {
  const run = await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } });
  if (!run) throw new ShiftError("この月の給料は計上されていません");
  await prisma.$transaction([
    prisma.journalEntry.update({ where: { id: run.journalEntryId }, data: { status: "VOID" } }),
    prisma.payrollRun.delete({ where: { id: run.id } }),
  ]);
}

export async function hasPayrollRuns(companyId: string) {
  return (await prisma.payrollRun.count({ where: { companyId } })) > 0;
}
