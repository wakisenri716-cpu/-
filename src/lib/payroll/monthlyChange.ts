import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { getPayrollSheet } from "@/lib/payroll/service";
import { healthGrade, healthStandard, pensionStandard } from "@/lib/payroll/deductions";

// 社会保険の月額変更(随時改定)。時給・通勤手当などの固定的賃金が変わった月から3か月の報酬の平均で、
// 今の標準報酬月額と2等級以上の差が出て、3か月とも支払基礎日数が17日以上なら、4か月目から標準報酬月額を変える(月額変更届)。
// 賃金が上がったのに等級が下がる(またはその逆)ときは対象外。

const DAYS = 17;
export const KIND_LABEL: Record<string, string> = { WAGE: "時給", COMMUTE: "通勤手当" };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const thisMonth = () => jstDateKey(new Date()).slice(0, 7);

// 時給・通勤手当を変えたときに記録する(変わっていなければ何もしない)
export async function recordWageChange(staff: { id: string; companyId: string; name: string }, kind: "WAGE" | "COMMUTE", before: number, after: number, month = thisMonth()) {
  if (before === after) return null;
  return prisma.wageChange.create({ data: { companyId: staff.companyId, staffId: staff.id, staffName: staff.name, month, kind, before, after } });
}

// 前に変えた分を、あとから記録する
export async function addWageChange(companyId: string, input: { staffId?: unknown; month?: unknown; kind?: unknown; before?: unknown; after?: unknown }) {
  const staff = await prisma.staff.findFirst({ where: { id: String(input.staffId ?? ""), companyId } });
  if (!staff) throw new UserError("スタッフを選んでください");
  const month = String(input.month ?? "");
  if (!MONTH.test(month)) throw new UserError("変わった月を選んでください");
  const kind = input.kind === "COMMUTE" ? "COMMUTE" : "WAGE";
  const num = (v: unknown, label: string) => {
    const n = Number(String(v ?? "").replace(/[,円\s]/g, ""));
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new UserError(`${label}を0以上の整数で入力してください`);
    return n;
  };
  const before = num(input.before, "変わる前の金額");
  const after = num(input.after, "変わった後の金額");
  if (before === after) throw new UserError("変わる前と後が同じです");
  return prisma.wageChange.create({ data: { companyId, staffId: staff.id, staffName: staff.name, month, kind, before, after } });
}

export async function deleteWageChange(companyId: string, id: string) {
  const change = await prisma.wageChange.findFirst({ where: { id, companyId } });
  if (!change) throw new UserError("記録が見つかりません");
  if (change.appliedAt) throw new UserError("反映した記録は消せません。先に反映を取り消してください");
  await prisma.wageChange.delete({ where: { id } });
  return change;
}

export type ChangeStatus = "CANDIDATE" | "WAITING" | "NOT_ENOUGH_DAYS" | "NO_CHANGE" | "OPPOSITE" | "NO_STANDARD" | "NOT_INSURED" | "APPLIED";

// 直近18か月の変動と判定
export async function listMonthlyChanges(companyId: string) {
  const from = addMonths(thisMonth(), -18);
  const [changes, staff] = await Promise.all([
    prisma.wageChange.findMany({ where: { companyId, month: { gte: from } }, orderBy: [{ month: "desc" }, { createdAt: "desc" }] }),
    prisma.staff.findMany({ where: { companyId }, select: { id: true, name: true, active: true, socialInsurance: true, standardMonthly: true, hourlyWage: true, commuteAllowance: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const byId = new Map(staff.map((s) => [s.id, s]));
  const current = thisMonth();
  // 同じ月の給与計算表は1回だけ作る
  const sheets = new Map<string, Awaited<ReturnType<typeof getPayrollSheet>>>();
  const sheetOf = async (m: string) => sheets.get(m) ?? sheets.set(m, await getPayrollSheet(companyId, m)).get(m)!;

  const rows = [];
  for (const c of changes) {
    const s = byId.get(c.staffId);
    const months = [0, 1, 2].map((i) => addMonths(c.month, i));
    const ready = months[2] < current; // 3か月目が終わっている
    const detail = await Promise.all(
      months.map(async (m) => {
        if (m > current) return { month: m, days: 0, pay: 0, future: true };
        const r = (await sheetOf(m)).rows.find((x) => x.staffId === c.staffId);
        return { month: m, days: r?.days ?? 0, pay: r?.gross ?? 0, future: false };
      }),
    );
    const average = Math.floor(detail.reduce((sum, d) => sum + d.pay, 0) / 3);
    const next = healthStandard(average);
    const currentStd = c.appliedAt ? c.previousStandard : (s?.standardMonthly ?? null);
    const currentGrade = currentStd === null ? null : healthGrade(currentStd);
    const nextGrade = healthGrade(next);
    const diff = currentGrade !== null && nextGrade !== null ? nextGrade - currentGrade : null;
    const up = c.after > c.before;
    let status: ChangeStatus;
    if (c.appliedAt) status = "APPLIED";
    else if (!s?.socialInsurance) status = "NOT_INSURED";
    else if (!ready) status = "WAITING";
    else if (detail.some((d) => d.days < DAYS)) status = "NOT_ENOUGH_DAYS";
    else if (currentStd === null) status = "NO_STANDARD";
    else if (diff === null || Math.abs(diff) < 2) status = "NO_CHANGE";
    else if (up !== diff > 0) status = "OPPOSITE";
    else status = "CANDIDATE";
    rows.push({
      id: c.id,
      staffId: c.staffId,
      staffName: s?.name ?? c.staffName,
      month: c.month,
      kind: c.kind,
      before: c.before,
      after: c.after,
      months: detail,
      average: ready ? average : null,
      current: currentStd,
      currentGrade,
      next: ready ? next : null,
      nextGrade: ready ? nextGrade : null,
      pension: ready ? pensionStandard(next) : null,
      diff: ready ? diff : null,
      status,
      // 4か月目(給与の対象月)から新しい標準報酬月額
      effectiveMonth: addMonths(c.month, 3),
      appliedAt: c.appliedAt ? jstDateKey(c.appliedAt) : null,
      appliedByName: c.appliedByName,
      appliedStandard: c.appliedStandard,
    });
  }
  return {
    rows,
    staff: staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, hourlyWage: s.hourlyWage, commuteAllowance: s.commuteAllowance })),
    candidates: rows.filter((r) => r.status === "CANDIDATE").length,
  };
}

export async function applyMonthlyChange(companyId: string, user: { name: string }, id: string) {
  const { rows } = await listMonthlyChanges(companyId);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new UserError("記録が見つかりません");
  if (row.status !== "CANDIDATE" || row.next === null) throw new UserError("この変動は月額変更の対象ではありません");
  await prisma.$transaction([
    prisma.staff.update({ where: { id: row.staffId }, data: { standardMonthly: row.next } }),
    prisma.wageChange.update({ where: { id }, data: { previousStandard: row.current, appliedStandard: row.next, appliedAt: new Date(), appliedByName: user.name } }),
  ]);
  return row;
}

export async function undoMonthlyChange(companyId: string, id: string) {
  const change = await prisma.wageChange.findFirst({ where: { id, companyId } });
  if (!change?.appliedAt) throw new UserError("この記録はまだ反映していません");
  await prisma.$transaction([
    prisma.staff.updateMany({ where: { id: change.staffId, companyId }, data: { standardMonthly: change.previousStandard } }),
    prisma.wageChange.update({ where: { id }, data: { previousStandard: null, appliedStandard: null, appliedAt: null, appliedByName: null } }),
  ]);
  return change;
}
