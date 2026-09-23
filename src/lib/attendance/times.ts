import type { TimeRecord } from "@prisma/client";
import { jstMidnight } from "@/lib/jst";
import type { ShiftTimes } from "@/lib/shifts/pay";

// 打刻の時刻を、シフトと同じ「出勤日の0時(日本時間)からの分数」に直す
export function minutesFromWorkDay(workDate: Date, at: Date): number {
  return Math.floor((at.getTime() - jstMidnight(workDate.toISOString().slice(0, 10)).getTime()) / 60_000);
}

export function recordTimes(record: Pick<TimeRecord, "date" | "clockIn" | "clockOut" | "breakMinutes">): ShiftTimes {
  const start = minutesFromWorkDay(record.date, record.clockIn);
  const end = record.clockOut ? minutesFromWorkDay(record.date, record.clockOut) : start;
  return { startMinutes: start, endMinutes: Math.max(start, end), breakMinutes: Math.min(record.breakMinutes, Math.max(0, end - start)) };
}
