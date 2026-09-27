import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import type { PayrollSheetRow } from "@/lib/payroll/service";
import { getMonthlyPayroll } from "@/lib/shifts/service";
import type { BonusRow } from "@/lib/payroll/bonus";

// 労働者名簿・賃金台帳(法定三帳簿。出勤簿は「勤怠一覧」)と労働条件通知書。

export const EMPLOYMENT_TYPES = { REGULAR: "正社員", CONTRACT: "契約社員", PART: "パート・アルバイト" } as const;

export type Profile = {
  kana?: string;
  birthDate?: string;
  gender?: string;
  address?: string;
  phone?: string;
  employmentType?: keyof typeof EMPLOYMENT_TYPES;
  job?: string;
  workplace?: string;
  contractEnd?: string;
  renewal?: string;
  workStart?: string;
  workEnd?: string;
  breakMinutes?: number;
  workDays?: string;
  holidays?: string;
  retireDate?: string;
  retireReason?: string;
};

export type LaborDefaults = {
  workplace?: string;
  holidays?: string;
  closingDay?: string;
  payDay?: string;
  payMethod?: string;
  retirement?: string;
  consultation?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const asObject = <T>(v: Prisma.JsonValue | null): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as T) : ({} as T));

function str(input: Record<string, unknown>, key: string, max: number) {
  const v = String(input[key] ?? "").trim();
  if (v.length > max) throw new UserError(`${max}文字以内で入力してください`);
  return v || undefined;
}

function date(input: Record<string, unknown>, key: string, label: string) {
  const v = String(input[key] ?? "").trim();
  if (!v) return undefined;
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new UserError(`${label}を正しく入力してください`);
  return v;
}

export function parseProfile(input: Record<string, unknown>): Profile {
  const type = String(input.employmentType ?? "");
  if (type && !(type in EMPLOYMENT_TYPES)) throw new UserError("雇用形態を選んでください");
  const workStart = str(input, "workStart", 5);
  const workEnd = str(input, "workEnd", 5);
  if ((workStart && !TIME.test(workStart)) || (workEnd && !TIME.test(workEnd))) throw new UserError("始業・終業の時刻を正しく入力してください");
  const breakMinutes = input.breakMinutes === undefined || input.breakMinutes === "" ? undefined : Number(input.breakMinutes);
  if (breakMinutes !== undefined && (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 600)) throw new UserError("休憩時間(分)を正しく入力してください");
  return {
    kana: str(input, "kana", 60),
    birthDate: date(input, "birthDate", "生年月日"),
    gender: str(input, "gender", 10),
    address: str(input, "address", 200),
    phone: str(input, "phone", 30),
    employmentType: (type || undefined) as Profile["employmentType"],
    job: str(input, "job", 100),
    workplace: str(input, "workplace", 100),
    contractEnd: date(input, "contractEnd", "契約の終わりの日"),
    renewal: str(input, "renewal", 200),
    workStart,
    workEnd,
    breakMinutes,
    workDays: str(input, "workDays", 100),
    holidays: str(input, "holidays", 200),
    retireDate: date(input, "retireDate", "退職日"),
    retireReason: str(input, "retireReason", 100),
  };
}

export async function getStaffRecords(companyId: string) {
  const [company, staff] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true, phone: true, laborDefaults: true } }),
    prisma.staff.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
  ]);
  return {
    company: { name: company.name, address: company.address, phone: company.phone },
    defaults: asObject<LaborDefaults>(company.laborDefaults),
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      active: s.active,
      hourlyWage: s.hourlyWage,
      hireDate: s.hireDate ? jstDateKey(s.hireDate) : null,
      weeklyDays: s.weeklyDays,
      scheduledMinutes: s.scheduledMinutes,
      socialInsurance: s.socialInsurance,
      employmentInsurance: s.employmentInsurance,
      commuteAllowance: s.commuteAllowance,
      profile: asObject<Profile>(s.profile),
    })),
  };
}

export async function updateProfile(companyId: string, staffId: string, input: Record<string, unknown>) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId } });
  if (!staff) throw new UserError("スタッフが見つかりません");
  const profile = parseProfile(input);
  const hireDate = input.hireDate === undefined ? undefined : date(input, "hireDate", "入社日");
  await prisma.staff.update({
    where: { id: staffId },
    data: {
      profile: JSON.parse(JSON.stringify(profile)) as Prisma.InputJsonValue,
      ...(input.hireDate !== undefined ? { hireDate: hireDate ? new Date(`${hireDate}T00:00:00Z`) : null } : {}),
    },
  });
  return staff.name;
}

export async function updateLaborDefaults(companyId: string, input: Record<string, unknown>) {
  const defaults: LaborDefaults = {
    workplace: str(input, "workplace", 100),
    holidays: str(input, "holidays", 200),
    closingDay: str(input, "closingDay", 30),
    payDay: str(input, "payDay", 30),
    payMethod: str(input, "payMethod", 60),
    retirement: str(input, "retirement", 300),
    consultation: str(input, "consultation", 200),
  };
  await prisma.company.update({ where: { id: companyId }, data: { laborDefaults: JSON.parse(JSON.stringify(defaults)) as Prisma.InputJsonValue } });
  return defaults;
}

export async function getStaffRecord(companyId: string, staffId: string) {
  const data = await getStaffRecords(companyId);
  const staff = data.staff.find((s) => s.id === staffId);
  return staff ? { ...data, person: staff } : null;
}

// ---- 賃金台帳 ----

export type LedgerColumn = {
  label: string;
  days: number | null;
  workMinutes: number | null;
  overtimeMinutes: number | null;
  nightMinutes: number | null;
  basePay: number;
  overtimePay: number;
  nightPay: number;
  leavePay: number;
  bonus: number;
  commute: number;
  gross: number;
  health: number;
  care: number;
  pension: number;
  employment: number;
  incomeTax: number;
  residentTax: number;
  totalDeductions: number;
  netPay: number;
};

// その年に計上した給料(働いた月)と賞与を、月ごとの列にする
export async function getWageLedger(companyId: string, staffId: string, yearValue: unknown) {
  const year = Number(yearValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError("年を正しく指定してください");
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId } });
  if (!staff) throw new UserError("スタッフが見つかりません");
  const [runs, bonuses] = await Promise.all([
    prisma.payrollRun.findMany({ where: { companyId, month: { startsWith: `${year}-` } }, orderBy: { month: "asc" } }),
    prisma.bonusRun.findMany({ where: { companyId, payDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { payDate: "asc" } }),
  ]);
  const columns: LedgerColumn[] = [];
  for (const run of runs) {
    if (!Array.isArray(run.details)) continue;
    const row = (run.details as unknown as PayrollSheetRow[]).find((r) => r.staffId === staffId);
    if (!row) continue;
    // 時間と支給の内訳を残していない古い記録は、いまの勤怠から計算し直す
    let hours = { workMinutes: row.workMinutes, overtimeMinutes: row.overtimeMinutes, nightMinutes: row.nightMinutes, basePay: row.basePay, nightPay: row.nightPay, overtimePay: row.overtimePay, leavePay: row.leavePay };
    if (hours.workMinutes === undefined) {
      const live = (await getMonthlyPayroll(companyId, run.month)).rows.find((r) => r.staffId === staffId);
      hours = { workMinutes: live?.workMinutes, overtimeMinutes: live?.overtimeMinutes, nightMinutes: live?.nightMinutes, basePay: live?.base, nightPay: live?.night, overtimePay: live?.overtime, leavePay: live?.leavePay };
    }
    const [, m] = run.month.split("-").map(Number);
    columns.push({
      label: `${m}月分`,
      days: row.days,
      workMinutes: hours.workMinutes ?? null,
      overtimeMinutes: hours.overtimeMinutes ?? null,
      nightMinutes: hours.nightMinutes ?? null,
      basePay: hours.basePay ?? row.wages,
      overtimePay: hours.overtimePay ?? 0,
      nightPay: hours.nightPay ?? 0,
      leavePay: hours.leavePay ?? 0,
      bonus: 0,
      commute: row.commute,
      gross: row.gross,
      health: row.health,
      care: row.care,
      pension: row.pension,
      employment: row.employment,
      incomeTax: row.incomeTax,
      residentTax: row.residentTax,
      totalDeductions: row.totalDeductions,
      netPay: row.netPay,
    });
  }
  for (const b of bonuses) {
    const row = (b.details as unknown as BonusRow[]).find((r) => r.staffId === staffId);
    if (!row) continue;
    columns.push({
      label: b.label,
      days: null,
      workMinutes: null,
      overtimeMinutes: null,
      nightMinutes: null,
      basePay: 0,
      overtimePay: 0,
      nightPay: 0,
      leavePay: 0,
      bonus: row.amount,
      commute: 0,
      gross: row.amount,
      health: row.health,
      care: row.care,
      pension: row.pension,
      employment: row.employment,
      incomeTax: row.incomeTax,
      residentTax: 0,
      totalDeductions: row.socialTotal + row.incomeTax,
      netPay: row.netPay,
    });
  }
  const sum = (k: keyof LedgerColumn) => columns.reduce((s, c) => s + ((c[k] as number | null) ?? 0), 0);
  const total: LedgerColumn = {
    label: "合計",
    days: sum("days"),
    workMinutes: sum("workMinutes"),
    overtimeMinutes: sum("overtimeMinutes"),
    nightMinutes: sum("nightMinutes"),
    basePay: sum("basePay"),
    overtimePay: sum("overtimePay"),
    nightPay: sum("nightPay"),
    leavePay: sum("leavePay"),
    bonus: sum("bonus"),
    commute: sum("commute"),
    gross: sum("gross"),
    health: sum("health"),
    care: sum("care"),
    pension: sum("pension"),
    employment: sum("employment"),
    incomeTax: sum("incomeTax"),
    residentTax: sum("residentTax"),
    totalDeductions: sum("totalDeductions"),
    netPay: sum("netPay"),
  };
  return { year, staff: { id: staff.id, name: staff.name, hourlyWage: staff.hourlyWage }, columns, total };
}
