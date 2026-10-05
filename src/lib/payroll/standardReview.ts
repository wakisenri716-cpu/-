import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { getPayrollSheet } from "@/lib/payroll/service";
import { healthGrade, healthStandard, pensionStandard } from "@/lib/payroll/deductions";

// 社会保険の算定基礎(定時決定)。4・5・6月に「支払った」給与(通勤手当を含む総支給額)の平均から、
// 9月分からの新しい標準報酬月額を決める。支払基礎日数が17日以上の月で平均し、
// 17日以上の月がない人(短時間で働く人)は15日以上の月で平均する。どの月も足りないときは今の標準報酬月額のまま。

const FULL_DAYS = 17;
const SHORT_DAYS = 15;

export type ReviewMonth = { label: string; workMonth: string; days: number; pay: number; counted: boolean; posted: boolean };
export type ReviewRow = {
  staffId: string;
  name: string;
  months: ReviewMonth[];
  total: number;
  average: number | null;
  rule: "FULL" | "SHORT" | "NONE";
  current: number | null;
  currentGrade: number | null;
  next: number | null; // 新しい標準報酬月額(健康保険)
  nextGrade: number | null;
  pension: number | null; // 厚生年金の標準報酬月額
  gradeDiff: number | null;
};

export function parseReviewYear(value: unknown, today = jstDateKey(new Date())) {
  if (value === undefined || value === null || value === "") {
    const [y, m] = today.split("-").map(Number);
    // 7月の提出時期からはその年、それより前は前の年を開く
    return m >= 7 ? y : y - 1;
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new UserError("年を正しく指定してください");
  return year;
}

const ym = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function getStandardReview(companyId: string, yearValue: unknown) {
  const year = parseReviewYear(yearValue);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { salaryPaidNextMonth: true } });
  // 4〜6月に支払った給与 = 翌月払いなら3〜5月分、当月払いなら4〜6月分
  const paid = [4, 5, 6].map((m) => ({ label: `${m}月`, workMonth: ym(year, company.salaryPaidNextMonth ? m - 1 : m) }));
  const [sheets, staff, saved] = await Promise.all([
    Promise.all(paid.map((p) => getPayrollSheet(companyId, p.workMonth))),
    prisma.staff.findMany({ where: { companyId, active: true, socialInsurance: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, standardMonthly: true } }),
    prisma.standardReview.findUnique({ where: { companyId_year: { companyId, year } } }),
  ]);

  const rows: ReviewRow[] = staff.map((s) => {
    const months = paid.map((p, i) => {
      const r = sheets[i].rows.find((x) => x.staffId === s.id);
      return { ...p, days: r?.days ?? 0, pay: r?.gross ?? 0, counted: false, posted: sheets[i].posted };
    });
    let rule: ReviewRow["rule"] = "FULL";
    let use = months.filter((m) => m.days >= FULL_DAYS && m.pay > 0);
    if (use.length === 0) {
      rule = "SHORT";
      use = months.filter((m) => m.days >= SHORT_DAYS && m.pay > 0);
    }
    if (use.length === 0) rule = "NONE";
    for (const m of use) m.counted = true;
    const total = use.reduce((sum, m) => sum + m.pay, 0);
    const average = use.length ? Math.floor(total / use.length) : null;
    const next = average === null ? null : healthStandard(average);
    const currentGrade = s.standardMonthly === null ? null : healthGrade(s.standardMonthly);
    const nextGrade = next === null ? null : healthGrade(next);
    return {
      staffId: s.id,
      name: s.name,
      months,
      total,
      average,
      rule,
      current: s.standardMonthly,
      currentGrade,
      next,
      nextGrade,
      pension: next === null ? null : pensionStandard(next),
      gradeDiff: currentGrade !== null && nextGrade !== null ? nextGrade - currentGrade : null,
    };
  });

  return {
    year,
    salaryPaidNextMonth: company.salaryPaidNextMonth,
    paidMonths: paid,
    allPosted: sheets.every((s) => s.posted),
    rows,
    applied: saved ? { by: saved.appliedByName, at: jstDateKey(saved.createdAt), count: (saved.details as unknown as AppliedRow[]).length } : null,
  };
}

type AppliedRow = { staffId: string; name: string; previous: number | null; next: number };

// 新しい標準報酬月額を給与計算の設定に入れる(9月分の給与から使う)。反映前の値は取消のために残す
export async function applyStandardReview(companyId: string, user: { name: string }, yearValue: unknown, staffIds: unknown) {
  const review = await getStandardReview(companyId, yearValue);
  if (review.applied) throw new UserError(`${review.year}年の算定基礎はもう反映しています。やり直すときは、先に反映を取り消してください`);
  const ids = new Set(Array.isArray(staffIds) ? staffIds.map(String) : review.rows.map((r) => r.staffId));
  const targets = review.rows.filter((r) => ids.has(r.staffId) && r.next !== null && r.next !== r.current);
  if (targets.length === 0) throw new UserError("変わる人がいません");
  const details: AppliedRow[] = targets.map((r) => ({ staffId: r.staffId, name: r.name, previous: r.current, next: r.next! }));
  await prisma.$transaction([
    ...details.map((d) => prisma.staff.update({ where: { id: d.staffId }, data: { standardMonthly: d.next } })),
    prisma.standardReview.create({ data: { companyId, year: review.year, details, appliedByName: user.name } }),
  ]);
  return { year: review.year, count: details.length };
}

// 反映を取り消して、反映前の標準報酬月額に戻す
export async function undoStandardReview(companyId: string, yearValue: unknown) {
  const year = parseReviewYear(yearValue);
  const saved = await prisma.standardReview.findUnique({ where: { companyId_year: { companyId, year } } });
  if (!saved) throw new UserError("この年はまだ反映していません");
  const details = saved.details as unknown as AppliedRow[];
  const existing = new Set((await prisma.staff.findMany({ where: { companyId, id: { in: details.map((d) => d.staffId) } }, select: { id: true } })).map((s) => s.id));
  await prisma.$transaction([
    ...details.filter((d) => existing.has(d.staffId)).map((d) => prisma.staff.update({ where: { id: d.staffId }, data: { standardMonthly: d.previous } })),
    prisma.standardReview.delete({ where: { id: saved.id } }),
  ]);
  return { year, count: details.length };
}
