import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import type { PayrollSheetRow } from "@/lib/payroll/service";
import type { BonusRow } from "@/lib/payroll/bonus";
import { calcYearEnd, MAX_PAY, normalizeInputs, EMPTY_INPUTS, type Paid, type YearEndInputs, type YearEndResult } from "@/lib/payroll/yearEndTax";

// 年末調整と源泉徴収票。その年(1〜12月)に「支払った」給料と賞与を集計する。
// 給料を翌月に払う会社は、前の年の12月分〜その年の11月分がその年の支払になる。

export function parseYear(value: unknown, now = new Date()) {
  const year = value === undefined || value === null || value === "" ? Number(jstDateKey(now).slice(0, 4)) : Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new UserError("年を正しく指定してください");
  return year;
}

type PaidDetail = Paid & { payrollMonths: string[]; bonuses: string[] };

export async function paidInYear(companyId: string, year: number) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { salaryPaidNextMonth: true } });
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(year, i - (company.salaryPaidNextMonth ? 1 : 0), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const [runs, bonuses] = await Promise.all([
    prisma.payrollRun.findMany({ where: { companyId, month: { in: months } }, orderBy: { month: "asc" }, select: { month: true, details: true } }),
    prisma.bonusRun.findMany({ where: { companyId, payDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { payDate: "asc" }, select: { label: true, details: true } }),
  ]);
  const map = new Map<string, PaidDetail>();
  const get = (id: string) => map.get(id) ?? map.set(id, { pay: 0, social: 0, tax: 0, payrollMonths: [], bonuses: [] }).get(id)!;
  for (const run of runs) {
    if (!Array.isArray(run.details)) continue;
    for (const row of run.details as unknown as PayrollSheetRow[]) {
      const p = get(row.staffId);
      // 通勤手当は非課税なので支払金額に入れない
      p.pay += row.wages;
      p.social += row.socialTotal;
      p.tax += row.incomeTax;
      p.payrollMonths.push(run.month);
    }
  }
  for (const b of bonuses) {
    for (const row of b.details as unknown as BonusRow[]) {
      const p = get(row.staffId);
      p.pay += row.amount;
      p.social += row.socialTotal;
      p.tax += row.incomeTax;
      p.bonuses.push(b.label);
    }
  }
  return { salaryPaidNextMonth: company.salaryPaidNextMonth, months, paid: map };
}

type ProfileLite = { kana?: string; birthDate?: string; address?: string; retireDate?: string; hireDate?: string };
const profileOf = (v: Prisma.JsonValue | null): ProfileLite => (v && typeof v === "object" && !Array.isArray(v) ? (v as ProfileLite) : {});

// 年末調整をしない人: 乙欄(ほかの勤め先で年末調整)・給与が2,000万円超・年の途中で退職
function notEligibleReason(staff: { taxColumn: string; profile: Prisma.JsonValue | null }, pay: number, year: number) {
  if (staff.taxColumn === "OTSU") return "乙欄(扶養控除等申告書なし)";
  if (pay > MAX_PAY) return "給与が2,000万円を超えている";
  const retire = profileOf(staff.profile).retireDate;
  if (retire && retire.startsWith(`${year}-`) && retire < `${year}-12-31`) return "年の途中で退職";
  return null;
}

function defaultInputs(staff: { dependents: number }): YearEndInputs {
  // 給与計算の扶養親族等の数を、まず一般の扶養の人数として入れておく(申告書を見て直してもらう)
  return { ...EMPTY_INPUTS, dependentsGeneral: Math.min(20, staff.dependents) };
}

export async function listYearEnd(companyId: string, yearValue: unknown) {
  const year = parseYear(yearValue);
  const [{ paid, months, salaryPaidNextMonth }, staff, saved] = await Promise.all([
    paidInYear(companyId, year),
    prisma.staff.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.yearEndAdjustment.findMany({ where: { companyId, year } }),
  ]);
  const savedBy = new Map(saved.map((s) => [s.staffId, s]));
  const rows = staff
    .filter((s) => paid.has(s.id) || savedBy.has(s.id))
    .map((s) => {
      const p = paid.get(s.id) ?? { pay: 0, social: 0, tax: 0, payrollMonths: [], bonuses: [] };
      const adj = savedBy.get(s.id);
      const reason = notEligibleReason(s, p.pay, year);
      const inputs = adj ? normalizeInputs(adj.inputs) : defaultInputs(s);
      const result = adj?.finalizedAt && adj.result ? (adj.result as unknown as YearEndResult) : reason ? null : calcYearEnd(p, inputs, year);
      return {
        staffId: s.id,
        name: s.name,
        paid: { pay: p.pay, social: p.social, tax: p.tax, payrollCount: p.payrollMonths.length, bonusCount: p.bonuses.length },
        reason,
        status: reason ? "excluded" : adj?.finalizedAt ? "finalized" : adj ? "entered" : "empty",
        result,
      };
    });
  const adjusted = rows.filter((r) => r.result);
  return {
    year,
    months: { from: months[0], to: months[11], salaryPaidNextMonth },
    rows,
    summary: {
      count: rows.length,
      finalized: rows.filter((r) => r.status === "finalized").length,
      refund: adjusted.reduce((s, r) => s + Math.max(0, r.result!.difference), 0),
      collect: adjusted.reduce((s, r) => s + Math.max(0, -r.result!.difference), 0),
    },
  };
}

export async function getYearEndStaff(companyId: string, staffId: string, yearValue: unknown) {
  const year = parseYear(yearValue);
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId } });
  if (!staff) return null;
  const [{ paid, months }, adj] = await Promise.all([paidInYear(companyId, year), prisma.yearEndAdjustment.findUnique({ where: { staffId_year: { staffId, year } } })]);
  const p = paid.get(staffId) ?? { pay: 0, social: 0, tax: 0, payrollMonths: [], bonuses: [] };
  return {
    year,
    months: { from: months[0], to: months[11] },
    staff: { id: staff.id, name: staff.name, taxColumn: staff.taxColumn, dependents: staff.dependents },
    paid: p,
    reason: notEligibleReason(staff, p.pay, year),
    inputs: adj ? normalizeInputs(adj.inputs) : defaultInputs(staff),
    saved: !!adj,
    finalizedAt: adj?.finalizedAt ? jstDateKey(adj.finalizedAt) : null,
    finalResult: adj?.finalizedAt && adj.result ? (adj.result as unknown as YearEndResult) : null,
  };
}

async function findStaff(companyId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId } });
  if (!staff) throw new UserError("スタッフが見つかりません");
  return staff;
}

export async function saveYearEndInputs(companyId: string, staffId: string, yearValue: unknown, raw: unknown) {
  const year = parseYear(yearValue);
  const staff = await findStaff(companyId, staffId);
  const current = await prisma.yearEndAdjustment.findUnique({ where: { staffId_year: { staffId, year } } });
  if (current?.finalizedAt) throw new UserError("確定した年末調整は直せません。先に「確定を取り消す」を押してください");
  const inputs = normalizeInputs(raw);
  await prisma.yearEndAdjustment.upsert({
    where: { staffId_year: { staffId, year } },
    create: { companyId, staffId, year, inputs: inputs as unknown as Prisma.InputJsonValue },
    update: { inputs: inputs as unknown as Prisma.InputJsonValue },
  });
  return { staff, year, inputs };
}

// 確定: そのときの計算結果を残す(源泉徴収票の税額になる)
export async function finalizeYearEnd(companyId: string, staffId: string, yearValue: unknown) {
  const year = parseYear(yearValue);
  const staff = await findStaff(companyId, staffId);
  const adj = await prisma.yearEndAdjustment.findUnique({ where: { staffId_year: { staffId, year } } });
  if (!adj) throw new UserError("先に申告の内容を保存してください");
  if (adj.finalizedAt) throw new UserError("すでに確定しています");
  const { paid } = await paidInYear(companyId, year);
  const p = paid.get(staffId) ?? { pay: 0, social: 0, tax: 0, payrollMonths: [], bonuses: [] };
  const reason = notEligibleReason(staff, p.pay, year);
  if (reason) throw new UserError(`この人は年末調整の対象外です(${reason})`);
  const result = calcYearEnd(p, normalizeInputs(adj.inputs), year);
  await prisma.yearEndAdjustment.update({ where: { id: adj.id }, data: { result: result as unknown as Prisma.InputJsonValue, finalizedAt: new Date() } });
  return { staff, year, result };
}

export async function unfinalizeYearEnd(companyId: string, staffId: string, yearValue: unknown) {
  const year = parseYear(yearValue);
  const staff = await findStaff(companyId, staffId);
  const updated = await prisma.yearEndAdjustment.updateMany({ where: { companyId, staffId, year, finalizedAt: { not: null } }, data: { finalizedAt: null, result: Prisma.DbNull } });
  if (!updated.count) throw new UserError("確定していません");
  return { staff, year };
}

// 源泉徴収票に載せる内容(1人分または全員分)
export async function getSlips(companyId: string, yearValue: unknown, staffId?: string) {
  const list = await listYearEnd(companyId, yearValue);
  const [company, staff, saved] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true, phone: true, representative: true } }),
    prisma.staff.findMany({ where: { companyId, ...(staffId ? { id: staffId } : {}) } }),
    prisma.yearEndAdjustment.findMany({ where: { companyId, year: list.year } }),
  ]);
  const staffBy = new Map(staff.map((s) => [s.id, s]));
  const inputsBy = new Map(saved.map((s) => [s.staffId, normalizeInputs(s.inputs)]));
  return {
    year: list.year,
    company,
    slips: list.rows
      .filter((r) => staffBy.has(r.staffId))
      .map((r) => {
        const s = staffBy.get(r.staffId)!;
        const profile = profileOf(s.profile);
        const inputs = inputsBy.get(r.staffId) ?? defaultInputs(s);
        // 年末調整を確定した人は年税額、確定していない人・対象外の人は徴収した税額を載せる
        const adjusted = r.status === "finalized" && !!r.result;
        return {
          staffId: r.staffId,
          name: s.name,
          kana: profile.kana ?? "",
          address: profile.address ?? "",
          birthDate: profile.birthDate ?? "",
          retireDate: profile.retireDate?.startsWith(`${list.year}-`) ? profile.retireDate : "",
          otsu: s.taxColumn === "OTSU",
          adjusted,
          pending: r.status === "empty" || r.status === "entered",
          pay: r.paid.pay + (adjusted ? inputs.prevPay : 0),
          income: adjusted ? r.result!.income : null,
          deductions: adjusted ? r.result!.deductions : null,
          tax: adjusted ? r.result!.annualTax : r.paid.tax,
          social: adjusted ? r.result!.social : r.paid.social,
          lifeInsurance: adjusted ? inputs.lifeInsurance : 0,
          earthquakeInsurance: adjusted ? inputs.earthquakeInsurance : 0,
          housingLoan: adjusted ? r.result!.housing : 0,
          spouse: inputs.spouse,
          spouseAmount: adjusted ? r.result!.spouse : 0,
          dependents: {
            general: inputs.dependentsGeneral,
            specific: inputs.dependentsSpecific,
            elderly: inputs.dependentsElderly + inputs.dependentsElderlyLiving,
            elderlyLiving: inputs.dependentsElderlyLiving,
          },
          basic: adjusted ? r.result!.basic : null,
          prev: adjusted && inputs.prevPay ? { pay: inputs.prevPay, social: inputs.prevSocial, tax: inputs.prevTax } : null,
        };
      }),
  };
}

// やることリスト用: 12月・1月に、年末調整を確定していない人の数(12月はその年、1月は前の年)
export async function countPendingYearEnd(companyId: string, now = new Date()) {
  const [y, m] = jstDateKey(now).split("-").map(Number);
  if (m !== 12 && m !== 1) return { year: y, count: 0 };
  const year = m === 12 ? y : y - 1;
  const list = await listYearEnd(companyId, year);
  return { year, count: list.rows.filter((r) => r.status === "empty" || r.status === "entered").length };
}
