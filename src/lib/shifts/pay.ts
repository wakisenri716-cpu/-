// 人件費の見込み計算(労働基準法の割増を反映した概算)。
// - 深夜割増: 22:00〜翌5:00 の勤務は25%増
// - 残業割増: 1日の実働が8時間を超えた分は25%増(深夜と重なれば合計50%増)
// 休憩は日中の勤務から先に差し引く。源泉所得税・社会保険料などの控除前の総支給額。

export const NIGHT_PREMIUM = 0.25;
export const OVERTIME_PREMIUM = 0.25;
export const DAILY_REGULAR_MINUTES = 8 * 60;

// 勤務日の0時からの分数で表した深夜帯(前日深夜の続き 0:00〜5:00 と、当日22:00〜翌5:00)
const NIGHT_WINDOWS: [number, number][] = [
  [0, 5 * 60],
  [22 * 60, 29 * 60],
];

export type ShiftTimes = { startMinutes: number; endMinutes: number; breakMinutes: number };

export function parseTime(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// 表示用。翌日にまたがる時刻は「翌2:00」のように表す
export function formatClock(minutes: number): string {
  return minutes >= 1440 ? `翌${formatMinutes(minutes - 1440)}` : formatMinutes(minutes);
}

export function shiftWorkMinutes(shift: ShiftTimes): { work: number; night: number } {
  const span = shift.endMinutes - shift.startMinutes;
  const nightSpan = NIGHT_WINDOWS.reduce(
    (sum, [from, to]) => sum + Math.max(0, Math.min(shift.endMinutes, to) - Math.max(shift.startMinutes, from)),
    0,
  );
  const daySpan = span - nightSpan;
  const nightBreak = Math.max(0, shift.breakMinutes - daySpan);
  return { work: Math.max(0, span - shift.breakMinutes), night: Math.max(0, nightSpan - nightBreak) };
}

export type PayBreakdown = { workMinutes: number; nightMinutes: number; overtimeMinutes: number; base: number; night: number; overtime: number };

// 1人・1日分のシフトから、円未満を含む金額を計算する(端数は集計後に丸める)
export function dailyPay(shifts: ShiftTimes[], hourlyWage: number): PayBreakdown {
  let workMinutes = 0;
  let nightMinutes = 0;
  for (const s of shifts) {
    const { work, night } = shiftWorkMinutes(s);
    workMinutes += work;
    nightMinutes += night;
  }
  const overtimeMinutes = Math.max(0, workMinutes - DAILY_REGULAR_MINUTES);
  const perMinute = hourlyWage / 60;
  return {
    workMinutes,
    nightMinutes,
    overtimeMinutes,
    base: perMinute * workMinutes,
    night: perMinute * NIGHT_PREMIUM * nightMinutes,
    overtime: perMinute * OVERTIME_PREMIUM * overtimeMinutes,
  };
}

export function addPay(a: PayBreakdown, b: PayBreakdown): PayBreakdown {
  return {
    workMinutes: a.workMinutes + b.workMinutes,
    nightMinutes: a.nightMinutes + b.nightMinutes,
    overtimeMinutes: a.overtimeMinutes + b.overtimeMinutes,
    base: a.base + b.base,
    night: a.night + b.night,
    overtime: a.overtime + b.overtime,
  };
}

export const EMPTY_PAY: PayBreakdown = { workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0, base: 0, night: 0, overtime: 0 };

export function roundPay(p: PayBreakdown) {
  const base = Math.round(p.base);
  const night = Math.round(p.night);
  const overtime = Math.round(p.overtime);
  return { ...p, base, night, overtime, total: base + night + overtime };
}
