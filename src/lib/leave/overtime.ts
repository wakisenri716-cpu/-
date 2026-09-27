import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { collectDays, payDays } from "@/lib/shifts/service";

// 残業時間(時間外労働)の集計と、36協定の上限のチェック。
// 時間外は「1日8時間を超えた分」と「週40時間を超えた分」(給与計算の割増と同じ数え方)。休日労働は区別していない。
// 過ぎた日は打刻の実績、これからの日はシフトの予定で数える(予定の分は見込み)。

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// 法律の上限(特別条項があっても超えられない): 単月100時間未満、2〜6か月の平均80時間以内、月45時間超えは年6回まで
const LEGAL_SINGLE = 100 * 60;
const LEGAL_AVERAGE = 80 * 60;
const OVER_LIMIT_TIMES = 6;

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export async function getOvertimeSettings(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { overtimeStartMonth: true, overtimeMonthlyLimit: true, overtimeYearlyLimit: true },
  });
  return { startMonth: c.overtimeStartMonth, monthlyLimit: c.overtimeMonthlyLimit, yearlyLimit: c.overtimeYearlyLimit };
}

export async function updateOvertimeSettings(companyId: string, input: { startMonth?: unknown; monthlyLimit?: unknown; yearlyLimit?: unknown }) {
  const data: Record<string, number> = {};
  const int = (v: unknown, min: number, max: number, message: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new UserError(message);
    return n;
  };
  if (input.startMonth !== undefined) data.overtimeStartMonth = int(input.startMonth, 1, 12, "起算月は1〜12月で選んでください");
  if (input.monthlyLimit !== undefined) data.overtimeMonthlyLimit = int(input.monthlyLimit, 1, 99, "月の上限は1〜99時間で入力してください(特別条項でも100時間未満)");
  if (input.yearlyLimit !== undefined) data.overtimeYearlyLimit = int(input.yearlyLimit, 1, 720, "年の上限は1〜720時間で入力してください");
  await prisma.company.update({ where: { id: companyId }, data });
  return getOvertimeSettings(companyId);
}

export type OvertimeFlag = { level: "danger" | "warn"; message: string };

export async function getOvertime(companyId: string, month?: string | null, now = new Date()) {
  const current = jstDateKey(now).slice(0, 7);
  const selected = month && MONTH.test(month) ? month : current;
  const settings = await getOvertimeSettings(companyId);
  const [y, m] = selected.split("-").map(Number);
  const startYear = m >= settings.startMonth ? y : y - 1;
  const yearStart = `${startYear}-${String(settings.startMonth).padStart(2, "0")}`;
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(yearStart, i));
  // 2〜6か月平均のため、協定の年の5か月前から数える
  const from = shiftMonth(yearStart, -5);
  const to = shiftMonth(yearStart, 12);
  const { days, inRange } = await collectDays(companyId, { gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${to}-01T00:00:00Z`) });
  const pays = payDays(days);

  const byStaff = new Map<string, { name: string; monthly: Map<string, number> }>();
  for (const [key, day] of days) {
    if (!inRange(day.date)) continue;
    const entry = byStaff.get(day.staff.id) ?? { name: day.staff.name, monthly: new Map<string, number>() };
    const mk = day.date.slice(0, 7);
    entry.monthly.set(mk, (entry.monthly.get(mk) ?? 0) + pays.get(key)!.overtimeMinutes);
    byStaff.set(day.staff.id, entry);
  }
  const staff = await prisma.staff.findMany({
    where: { companyId, OR: [{ active: true }, { id: { in: [...byStaff.keys()] } }] },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  const monthlyLimit = settings.monthlyLimit * 60;
  const yearlyLimit = settings.yearlyLimit * 60;
  const rows = staff.map((s) => {
    const monthly = byStaff.get(s.id)?.monthly ?? new Map<string, number>();
    const of = (mk: string) => monthly.get(mk) ?? 0;
    const selectedIndex = months.indexOf(selected);
    const yearToDate = months.slice(0, selectedIndex + 1).reduce((sum, mk) => sum + of(mk), 0);
    const yearTotal = months.reduce((sum, mk) => sum + of(mk), 0);
    const overCount = months.filter((mk) => of(mk) > monthlyLimit).length;
    // 選んだ月で終わる2〜6か月の平均のうち、いちばん高いもの
    let maxAverage = 0;
    for (let n = 2; n <= 6; n++) {
      const span = Array.from({ length: n }, (_, i) => of(shiftMonth(selected, -i)));
      maxAverage = Math.max(maxAverage, span.reduce((a, b) => a + b, 0) / n);
    }
    const flags: OvertimeFlag[] = [];
    const thisMonth = of(selected);
    const h = (min: number) => `${Math.round((min / 60) * 10) / 10}時間`;
    if (thisMonth >= LEGAL_SINGLE) flags.push({ level: "danger", message: `この月の残業が${h(thisMonth)}です(法律の上限は100時間未満)` });
    else if (thisMonth > monthlyLimit) flags.push({ level: "danger", message: `この月の残業が上限の${settings.monthlyLimit}時間を超えています(${h(thisMonth)})` });
    else if (thisMonth >= monthlyLimit * 0.8) flags.push({ level: "warn", message: `この月の残業が上限の8割を超えました(${h(thisMonth)} / ${settings.monthlyLimit}時間)` });
    if (maxAverage > LEGAL_AVERAGE) flags.push({ level: "danger", message: `2〜6か月の平均が80時間を超えています(${h(Math.round(maxAverage))})` });
    if (yearTotal > yearlyLimit) flags.push({ level: "danger", message: `協定の1年の残業が上限の${settings.yearlyLimit}時間を超えています(${h(yearTotal)})` });
    else if (yearTotal >= yearlyLimit * 0.8) flags.push({ level: "warn", message: `協定の1年の残業が上限の8割を超えました(${h(yearTotal)} / ${settings.yearlyLimit}時間)` });
    if (overCount > OVER_LIMIT_TIMES) flags.push({ level: "danger", message: `月${settings.monthlyLimit}時間を超えた月が${overCount}回あります(年6回まで)` });
    return {
      id: s.id,
      name: s.name,
      months: months.map((mk) => ({ month: mk, minutes: of(mk), forecast: mk >= current })),
      thisMonth,
      yearToDate,
      yearTotal,
      overCount,
      flags,
    };
  });
  return { settings, selected, current, months, rows };
}

// ダッシュボード用: 今月の残業が上限に近い・超えているなど、注意が必要な人数
export async function countOvertimeAlerts(companyId: string, now = new Date()) {
  const { rows } = await getOvertime(companyId, null, now);
  return rows.filter((r) => r.flags.length > 0).length;
}
