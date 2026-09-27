import { prisma } from "@/lib/prisma";
import { toBooksClosedError, UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "@/lib/accounting/accounts";
import { employeeShare, type Rates } from "./deductions";
import { getPayrollSettings, type PayrollSheetRow } from "./service";

// 賞与(ボーナス)の計算と計上。
// - 標準賞与額: 支給額の1,000円未満を切り捨てた額。健康保険・介護保険は年度(4月〜翌3月)の累計573万円まで、厚生年金は1回150万円まで
// - 雇用保険料: 支給額 × 料率
// - 源泉所得税: (支給額 − 社会保険料等) × 算出率。算出率は「前月の社会保険料等控除後の給与」と扶養の人数から、
//   国税庁の「賞与に対する源泉徴収税額の算出率の表」で確かめて入れてもらう(前月の給与がないときなどは月額表で計算する)

const HEALTH_YEAR_CAP = 5_730_000;
const PENSION_CAP = 1_500_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const times = (amount: number, rate: number) => (amount * rate) / 100_000;

export type BonusRow = {
  staffId: string;
  name: string;
  amount: number;
  standard: number;
  healthStandard: number;
  pensionStandard: number;
  health: number;
  care: number;
  pension: number;
  employment: number;
  socialTotal: number;
  taxable: number;
  taxRate: number; // %
  incomeTax: number;
  netPay: number;
  employerSocial: number;
};

export function calcBonus(
  amount: number,
  staff: { socialInsurance: boolean; careInsurance: boolean; employmentInsurance: boolean },
  rates: Rates,
  healthYearToDate: number,
  taxRate: number,
) {
  const standard = Math.floor(amount / 1000) * 1000;
  let healthStandard = 0;
  let pensionStandard = 0;
  let health = 0;
  let care = 0;
  let pension = 0;
  let employerSocial = 0;
  if (staff.socialInsurance) {
    healthStandard = Math.min(standard, Math.max(0, HEALTH_YEAR_CAP - healthYearToDate));
    pensionStandard = Math.min(standard, PENSION_CAP);
    const healthTotal = times(healthStandard, rates.health);
    const careTotal = staff.careInsurance ? times(healthStandard, rates.care) : 0;
    const pensionTotal = times(pensionStandard, rates.pension);
    health = employeeShare(healthTotal / 2);
    care = employeeShare(careTotal / 2);
    pension = employeeShare(pensionTotal / 2);
    employerSocial = Math.floor(healthTotal) - health + (Math.floor(careTotal) - care) + (Math.floor(pensionTotal) - pension);
  }
  const employment = staff.employmentInsurance ? employeeShare(times(amount, rates.employment)) : 0;
  const socialTotal = health + care + pension + employment;
  const taxable = Math.max(0, amount - socialTotal);
  const incomeTax = Math.floor((taxable * Math.round(taxRate * 1000)) / 100_000);
  return { standard, healthStandard, pensionStandard, health, care, pension, employment, socialTotal, taxable, taxRate, incomeTax, netPay: amount - socialTotal - incomeTax, employerSocial: Math.max(0, employerSocial) };
}

// 年度(4月〜翌3月)の健康保険の標準賞与額の累計
function fiscalYearStart(date: string) {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(m >= 4 ? y : y - 1, 3, 1));
}

async function healthYearToDate(companyId: string, payDate: string) {
  const runs = await prisma.bonusRun.findMany({
    where: { companyId, payDate: { gte: fiscalYearStart(payDate), lt: new Date(`${payDate}T00:00:00Z`) } },
    select: { details: true },
  });
  const sums = new Map<string, number>();
  for (const r of runs) for (const row of r.details as unknown as BonusRow[]) sums.set(row.staffId, (sums.get(row.staffId) ?? 0) + row.healthStandard);
  return sums;
}

// 算出率を調べるための情報: 前月(支給日より前で直近)に計上した給料の、社会保険料等控除後の額
export async function getBonusOverview(companyId: string) {
  const [runs, staff, payroll] = await Promise.all([
    prisma.bonusRun.findMany({ where: { companyId }, orderBy: { payDate: "desc" }, take: 20 }),
    prisma.staff.findMany({
      where: { companyId, active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, dependents: true, taxColumn: true, socialInsurance: true, careInsurance: true, employmentInsurance: true },
    }),
    prisma.payrollRun.findMany({ where: { companyId }, orderBy: { month: "desc" }, take: 3, select: { month: true, details: true } }),
  ]);
  const latest = payroll.find((p) => Array.isArray(p.details));
  const prev = new Map((latest ? (latest.details as unknown as PayrollSheetRow[]) : []).map((r) => [r.staffId, r.taxableAfterSocial]));
  return {
    runs: runs.map((r) => {
      const rows = r.details as unknown as BonusRow[];
      return { id: r.id, label: r.label, payDate: jstDateKey(r.payDate), people: rows.length, total: r.total, netPay: rows.reduce((s, x) => s + x.netPay, 0) };
    }),
    previousMonth: latest?.month ?? null,
    staff: staff.map((s) => ({ ...s, previousTaxable: prev.get(s.id) ?? null })),
  };
}

type Item = { staffId?: unknown; amount?: unknown; taxRate?: unknown };

async function buildRows(companyId: string, payDate: string, items: Item[]) {
  if (!DATE.test(payDate)) throw new UserError("支給日を正しく入力してください");
  const list = items.filter((i) => Number(i.amount) > 0);
  if (!list.length) throw new UserError("支給額を1人以上入力してください");
  const [settings, ytd, staff] = await Promise.all([
    getPayrollSettings(companyId),
    healthYearToDate(companyId, payDate),
    prisma.staff.findMany({ where: { companyId, id: { in: list.map((i) => String(i.staffId)) } } }),
  ]);
  return list.map((item): BonusRow => {
    const s = staff.find((x) => x.id === String(item.staffId));
    if (!s) throw new UserError("スタッフが見つかりません");
    const amount = Number(item.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) throw new UserError(`${s.name}さんの支給額を正しく入力してください`);
    const taxRate = Number(item.taxRate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 50) throw new UserError(`${s.name}さんの源泉所得税の算出率を正しく入力してください(%)`);
    return { staffId: s.id, name: s.name, amount, ...calcBonus(amount, s, settings.rates, ytd.get(s.id) ?? 0, taxRate) };
  });
}

export async function previewBonus(companyId: string, input: { payDate?: unknown; items?: unknown }) {
  const rows = await buildRows(companyId, String(input.payDate ?? ""), Array.isArray(input.items) ? (input.items as Item[]) : []);
  return { rows, totals: totalsOf(rows) };
}

function totalsOf(rows: BonusRow[]) {
  const keys = ["amount", "health", "care", "pension", "employment", "socialTotal", "incomeTax", "netPay", "employerSocial"] as const;
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])) as Record<(typeof keys)[number], number>;
}

// 計上: 賞与・法定福利費(会社負担) / 預り金(控除)・未払金(差引支給額と会社負担)
export async function postBonus(companyId: string, input: { label?: unknown; payDate?: unknown; items?: unknown }) {
  const label = String(input.label ?? "").trim().slice(0, 40);
  if (!label) throw new UserError("賞与の名前を入力してください(例: 2026年夏季賞与)");
  const payDate = String(input.payDate ?? "");
  const rows = await buildRows(companyId, payDate, Array.isArray(input.items) ? (input.items as Item[]) : []);
  const t = totalsOf(rows);
  const withheld = t.socialTotal + t.incomeTax;
  try {
    return await prisma.$transaction(async (tx) => {
      const [bonus, welfare, deposit, accrued] = await Promise.all(["5115", "5120", "2120", "2020"].map((code) => ensureAccount(tx, companyId, code)));
      const lines = [
        { accountId: bonus.id, debit: t.amount, credit: 0, memo: "賞与(総支給額)" },
        t.employerSocial > 0 && { accountId: welfare.id, debit: t.employerSocial, credit: 0, memo: "社会保険料(会社負担分)" },
        withheld > 0 && { accountId: deposit.id, debit: 0, credit: withheld, memo: "源泉所得税・社会保険料・雇用保険料(本人負担分)" },
        { accountId: accrued.id, debit: 0, credit: t.netPay + t.employerSocial, memo: "差引支給額と社会保険料(会社負担分)の未払い" },
      ].filter((l): l is { accountId: string; debit: number; credit: number; memo: string } => !!l && (l.debit > 0 || l.credit > 0));
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${payDate}T00:00:00Z`),
          description: `賞与計上 ${label}(${rows.length}名・差引支給 ${t.netPay.toLocaleString("ja-JP")}円)`,
          sourceType: "PAYROLL",
          status: "AUTO_POSTED",
          createdByAi: false,
          lines: { create: lines },
        },
      });
      return tx.bonusRun.create({ data: { companyId, label, payDate: new Date(`${payDate}T00:00:00Z`), total: t.amount, details: rows as unknown as object, journalEntryId: entry.id } });
    });
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
}

export async function voidBonus(companyId: string, id: string) {
  const run = await prisma.bonusRun.findFirst({ where: { id, companyId } });
  if (!run) throw new UserError("賞与の記録が見つかりません");
  try {
    await prisma.$transaction([prisma.bonusRun.delete({ where: { id } }), prisma.journalEntry.update({ where: { id: run.journalEntryId }, data: { status: "VOID" } })]);
  } catch (error) {
    throw toBooksClosedError(error) ?? error;
  }
  return run;
}

export async function getBonusRun(companyId: string, id: string) {
  const run = await prisma.bonusRun.findFirst({ where: { id, companyId }, include: { company: { select: { name: true, address: true } } } });
  if (!run) return null;
  return { ...run, rows: run.details as unknown as BonusRow[] };
}

// 源泉所得税の納付・支払調書・振込データ用: 支給した賞与を「月」と人ごとの額で
export async function bonusPayments(companyId: string) {
  const runs = await prisma.bonusRun.findMany({ where: { companyId }, orderBy: { payDate: "asc" } });
  return runs.map((r) => ({ id: r.id, label: r.label, payMonth: jstDateKey(r.payDate).slice(0, 7), rows: r.details as unknown as BonusRow[] }));
}
