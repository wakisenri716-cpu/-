import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { ensureAccount } from "@/lib/accounting/accounts";
import { getMonthlyPayroll } from "@/lib/shifts/service";
import { calcDeductions, type Deductions, type Rates, type StaffPayrollSettings } from "./deductions";

// 給与計算: シフト・打刻から出した総支給額に、社会保険料・雇用保険料・源泉所得税・住民税の控除をかけて差引支給額を出す。
// 計上すると「給料手当・旅費交通費・法定福利費 / 預り金・未払金」の仕訳を作り、計算結果をそのまま残す。

export class PayrollError extends UserError {}

const ACCOUNTS = { salary: "5110", commute: "5010", welfare: "5120", withheld: "2120", accrued: "2020" } as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type PayrollSheetRow = Deductions & { staffId: string; name: string; hourlyWage: number; days: number; taxColumn: string; dependents: number };

function checkMonth(month: string) {
  if (!MONTH.test(month)) throw new PayrollError("月を正しく指定してください");
}

export async function getPayrollSettings(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { payrollPrefecture: true, payrollHealthRate: true, payrollCareRate: true, payrollPensionRate: true, payrollEmploymentRate: true },
  });
  return {
    prefecture: c.payrollPrefecture,
    rates: { health: c.payrollHealthRate, care: c.payrollCareRate, pension: c.payrollPensionRate, employment: c.payrollEmploymentRate } satisfies Rates,
  };
}

const RATE_LIMITS: Record<keyof Rates, [number, number, string]> = {
  health: [1_000, 20_000, "健康保険料率"],
  care: [0, 5_000, "介護保険料率"],
  pension: [0, 30_000, "厚生年金保険料率"],
  employment: [0, 3_000, "雇用保険料率(本人負担)"],
};

// 料率は画面では「%」で受け取り、0.001% 単位の整数で保存する
export async function updatePayrollSettings(companyId: string, input: { prefecture?: unknown; rates?: Partial<Record<keyof Rates, unknown>> }) {
  const data: Record<string, string | number> = {};
  if (input.prefecture !== undefined) {
    const prefecture = String(input.prefecture ?? "").trim().slice(0, 10);
    if (!prefecture) throw new PayrollError("都道府県を入力してください");
    data.payrollPrefecture = prefecture;
  }
  const columns: Record<keyof Rates, string> = { health: "payrollHealthRate", care: "payrollCareRate", pension: "payrollPensionRate", employment: "payrollEmploymentRate" };
  for (const key of Object.keys(columns) as (keyof Rates)[]) {
    const raw = input.rates?.[key];
    if (raw === undefined) continue;
    const value = Math.round(Number(raw) * 1000);
    const [min, max, label] = RATE_LIMITS[key];
    if (!Number.isFinite(value) || value < min || value > max) throw new PayrollError(`${label}を正しく入力してください(%)`);
    data[columns[key]] = value;
  }
  await prisma.company.update({ where: { id: companyId }, data });
  return getPayrollSettings(companyId);
}

const STAFF_FIELDS = {
  id: true,
  name: true,
  active: true,
  dependents: true,
  taxColumn: true,
  socialInsurance: true,
  careInsurance: true,
  employmentInsurance: true,
  standardMonthly: true,
  commuteAllowance: true,
  residentTax: true,
} as const;

export async function listStaffPayroll(companyId: string) {
  return prisma.staff.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: STAFF_FIELDS });
}

const intIn = (value: unknown, label: string, max: number) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new PayrollError(`${label}を正しく入力してください`);
  return n;
};

export async function updateStaffPayroll(companyId: string, staffId: string, input: Record<string, unknown>) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId } });
  if (!staff) throw new PayrollError("スタッフが見つかりません");
  const data: Partial<StaffPayrollSettings> = {};
  if (input.dependents !== undefined) data.dependents = intIn(input.dependents, "扶養親族等の数", 20);
  if (input.taxColumn !== undefined) {
    if (input.taxColumn !== "KOU" && input.taxColumn !== "OTSU") throw new PayrollError("税額表の区分を選んでください");
    data.taxColumn = input.taxColumn;
  }
  for (const key of ["socialInsurance", "careInsurance", "employmentInsurance"] as const) {
    if (typeof input[key] === "boolean") data[key] = input[key] as boolean;
  }
  if (input.standardMonthly !== undefined) data.standardMonthly = input.standardMonthly === null || input.standardMonthly === "" ? null : intIn(input.standardMonthly, "標準報酬月額", 2_000_000);
  if (input.commuteAllowance !== undefined) data.commuteAllowance = intIn(input.commuteAllowance || 0, "通勤手当", 1_000_000);
  if (input.residentTax !== undefined) data.residentTax = intIn(input.residentTax || 0, "住民税", 1_000_000);
  if (data.careInsurance && !(data.socialInsurance ?? staff.socialInsurance)) throw new PayrollError("介護保険は、健康保険に加入している人だけ選べます");
  return prisma.staff.update({ where: { id: staffId }, data, select: STAFF_FIELDS });
}

// その月の給与計算表。計上済みなら計上したときの結果を返す。
export async function getPayrollSheet(companyId: string, month: string) {
  checkMonth(month);
  const [{ rows, run }, settings, overrides] = await Promise.all([
    getMonthlyPayroll(companyId, month),
    getPayrollSettings(companyId),
    prisma.payrollOverride.findMany({ where: { companyId, month } }),
  ]);
  if (run?.details && Array.isArray(run.details)) {
    const posted = run.details as unknown as PayrollSheetRow[];
    return { month, rows: posted, totals: sumRows(posted), settings, posted: true, postedAt: run.createdAt, changedSincePost: run.totalAmount !== rows.reduce((s, r) => s + r.total, 0) };
  }
  const staff = await prisma.staff.findMany({ where: { companyId, id: { in: rows.map((r) => r.staffId) } }, select: STAFF_FIELDS });
  const byId = new Map(staff.map((s) => [s.id, s]));
  const overrideBy = new Map(overrides.map((o) => [o.staffId, o.incomeTax]));
  const sheet: PayrollSheetRow[] = rows.map((r) => {
    const s = byId.get(r.staffId)!;
    return {
      staffId: r.staffId,
      name: r.name,
      hourlyWage: r.hourlyWage,
      days: r.actualDays + r.plannedDays,
      taxColumn: s.taxColumn,
      dependents: s.dependents,
      ...calcDeductions(r.total, s, settings.rates, overrideBy.get(r.staffId) ?? null),
    };
  });
  return { month, rows: sheet, totals: sumRows(sheet), settings, posted: !!run, postedAt: run?.createdAt ?? null, changedSincePost: false };
}

function sumRows(rows: PayrollSheetRow[]) {
  const keys = ["wages", "commute", "gross", "health", "care", "pension", "employment", "incomeTax", "residentTax", "totalDeductions", "netPay", "employerSocial"] as const;
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])) as Record<(typeof keys)[number], number>;
}

// 源泉所得税を手で直す(null で自動計算に戻す)。計上済みの月は変えられない。
export async function setIncomeTaxOverride(companyId: string, staffId: string, month: string, incomeTax: unknown) {
  checkMonth(month);
  if (await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } })) throw new PayrollError("計上済みの月は変更できません。計上を取り消してから直してください");
  if (!(await prisma.staff.findFirst({ where: { id: staffId, companyId } }))) throw new PayrollError("スタッフが見つかりません");
  if (incomeTax === null || incomeTax === "") {
    await prisma.payrollOverride.deleteMany({ where: { staffId, month } });
    return null;
  }
  const value = intIn(incomeTax, "源泉所得税", 10_000_000);
  await prisma.payrollOverride.upsert({ where: { staffId_month: { staffId, month } }, create: { companyId, staffId, month, incomeTax: value }, update: { incomeTax: value } });
  return value;
}

// 給料を計上する(控除を分けた仕訳)
export async function postPayrollWithDeductions(companyId: string, month: string) {
  const sheet = await getPayrollSheet(companyId, month);
  if (sheet.posted) throw new PayrollError("この月の給料はすでに計上しています");
  if (sheet.totals.gross <= 0) throw new PayrollError("この月のシフトがないため計上できません");
  const missing = sheet.rows.filter((r) => r.incomeTaxNeedsInput);
  if (missing.length) throw new PayrollError(`${missing.map((r) => r.name).join("・")}さんの源泉所得税(乙欄)を税額表で確かめて入力してください`);
  const negative = sheet.rows.filter((r) => r.netPay < 0);
  if (negative.length) throw new PayrollError(`${negative.map((r) => r.name).join("・")}さんの差引支給額がマイナスです。控除の設定を確認してください`);

  const t = sheet.totals;
  const [y, m] = month.split("-").map(Number);
  const withheld = t.totalDeductions;
  try {
    return await prisma.$transaction(async (tx) => {
      const acc = Object.fromEntries(await Promise.all(Object.entries(ACCOUNTS).map(async ([k, code]) => [k, await ensureAccount(tx, companyId, code)]))) as Record<keyof typeof ACCOUNTS, { id: string }>;
      const lines = [
        { accountId: acc.salary.id, debit: t.wages, credit: 0, memo: "総支給額(給与)" },
        t.commute > 0 && { accountId: acc.commute.id, debit: t.commute, credit: 0, memo: "通勤手当" },
        t.employerSocial > 0 && { accountId: acc.welfare.id, debit: t.employerSocial, credit: 0, memo: "社会保険料(会社負担分)" },
        withheld > 0 && { accountId: acc.withheld.id, debit: 0, credit: withheld, memo: "源泉所得税・住民税・社会保険料・雇用保険料(本人負担分)" },
        { accountId: acc.accrued.id, debit: 0, credit: t.netPay + t.employerSocial, memo: t.employerSocial > 0 ? "差引支給額と社会保険料(会社負担分)の未払い" : "差引支給額の未払い" },
      ].filter((l): l is { accountId: string; debit: number; credit: number; memo: string } => !!l && (l.debit > 0 || l.credit > 0));
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(Date.UTC(y, m, 0)),
          description: `給料計上 ${y}年${m}月分(${sheet.rows.length}名・差引支給 ${t.netPay.toLocaleString("ja-JP")}円)`,
          sourceType: "PAYROLL",
          status: "AUTO_POSTED",
          createdByAi: false,
          lines: { create: lines },
        },
      });
      return tx.payrollRun.create({
        data: { companyId, month, totalAmount: t.wages, details: sheet.rows as unknown as object, journalEntryId: entry.id },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new PayrollError("この月の給料はすでに計上しています");
    throw error;
  }
}
