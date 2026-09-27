import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { dateKey } from "@/lib/shifts/service";
import { addMonths, allocate, balanceOn, EXPIRE_YEARS, grantSchedule, nextGrant, obligations, OBLIGATION_HALF_DAYS } from "./rules";

// 有給休暇の管理: 入社日からの自動付与、取得の登録、残日数(古い付与から消化・2年で時効)、年5日の取得義務。

export class LeaveError extends UserError {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: unknown, label: string) {
  const key = String(value ?? "");
  const d = new Date(`${key}T00:00:00Z`);
  if (!DATE.test(key) || Number.isNaN(d.getTime()) || dateKey(d) !== key) throw new LeaveError(`${label}を正しく入力してください`);
  return d;
}

const todayDate = (now = new Date()) => new Date(`${jstDateKey(now)}T00:00:00Z`);

// 入社日が入っている在籍スタッフに、今日までに付与される分を作る(何度呼んでも同じ)
export async function ensureAutoGrants(companyId: string, now = new Date()) {
  const today = todayDate(now);
  const staff = await prisma.staff.findMany({ where: { companyId, active: true, hireDate: { not: null } } });
  const data = staff.flatMap((s) =>
    grantSchedule(s.hireDate!, s.weeklyDays, today).map((g) => ({ companyId, staffId: s.id, grantDate: g.grantDate, halfDays: g.halfDays, auto: true })),
  );
  if (data.length) await prisma.leaveGrant.createMany({ data, skipDuplicates: true });
}

async function staffLeave(companyId: string, staffId: string) {
  const [grants, taken] = await Promise.all([
    prisma.leaveGrant.findMany({ where: { companyId, staffId }, orderBy: { grantDate: "asc" } }),
    prisma.leaveTaken.findMany({ where: { companyId, staffId }, orderBy: { date: "asc" } }),
  ]);
  return { grants, taken };
}

export async function getLeaveOverview(companyId: string, now = new Date()) {
  await ensureAutoGrants(companyId, now);
  const today = todayDate(now);
  const [staff, grants, taken] = await Promise.all([
    prisma.staff.findMany({ where: { companyId, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.leaveGrant.findMany({ where: { companyId }, orderBy: { grantDate: "asc" } }),
    prisma.leaveTaken.findMany({ where: { companyId }, orderBy: { date: "desc" } }),
  ]);
  const soon = addMonths(today, 3);
  return {
    today: dateKey(today),
    staff: staff.map((s) => {
      const g = grants.filter((x) => x.staffId === s.id);
      const t = taken.filter((x) => x.staffId === s.id);
      const { pool, shortage } = allocate(g, t);
      const next = s.hireDate ? nextGrant(s.hireDate, s.weeklyDays, today) : null;
      return {
        id: s.id,
        name: s.name,
        hireDate: s.hireDate ? dateKey(s.hireDate) : null,
        weeklyDays: s.weeklyDays,
        scheduledMinutes: s.scheduledMinutes,
        hourlyWage: s.hourlyWage,
        balance: balanceOn(pool, today),
        // 3か月以内に時効になる残り
        expiring: pool
          .filter((p) => p.remaining > 0 && p.grantDate <= today && today < p.expires && p.expires <= soon)
          .map((p) => ({ halfDays: p.remaining, expires: dateKey(new Date(p.expires.getTime() - 86_400_000)) })),
        next: next ? { date: dateKey(next.grantDate), halfDays: next.halfDays } : null,
        obligations: obligations(g, t, today).map((o) => ({
          grantDate: dateKey(o.grantDate),
          deadline: dateKey(o.deadline),
          used: o.used,
          required: OBLIGATION_HALF_DAYS,
          met: o.met,
          ended: o.ended,
        })),
        grants: pool
          .slice()
          .reverse()
          .map((p) => ({
            id: p.id,
            grantDate: dateKey(p.grantDate),
            halfDays: p.halfDays,
            remaining: p.remaining,
            expires: dateKey(new Date(p.expires.getTime() - 86_400_000)),
            expired: p.expires <= today,
            auto: g.find((x) => x.id === p.id)!.auto,
            note: g.find((x) => x.id === p.id)!.note,
          })),
        taken: t.map((x) => ({ id: x.id, date: dateKey(x.date), halfDays: x.halfDays, bulk: x.bulk, note: x.note, short: shortage.get(x.id) ?? 0 })),
      };
    }),
  };
}

// 年5日の取得義務の期限が近い(90日以内)のに足りていない人数
export async function countLeaveObligationAlerts(companyId: string, now = new Date()) {
  const overview = await getLeaveOverview(companyId, now);
  const limit = dateKey(new Date(todayDate(now).getTime() + 90 * 86_400_000));
  return overview.staff.filter((s) => s.obligations.some((o) => !o.met && o.deadline <= limit)).length;
}

export async function updateLeaveSettings(companyId: string, staffId: string, input: { hireDate?: unknown; weeklyDays?: unknown; scheduledMinutes?: unknown }) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, companyId } });
  if (!staff) throw new LeaveError("スタッフが見つかりません");
  const data: { hireDate?: Date | null; weeklyDays?: number; scheduledMinutes?: number } = {};
  if (input.hireDate !== undefined) data.hireDate = input.hireDate === null || input.hireDate === "" ? null : toDate(input.hireDate, "入社日");
  if (data.hireDate && data.hireDate > todayDate()) throw new LeaveError("入社日は今日より前の日付にしてください");
  if (input.weeklyDays !== undefined) {
    const n = Number(input.weeklyDays);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new LeaveError("週の所定労働日数は1〜5日で選んでください(週5日以上・週30時間以上は5)");
    data.weeklyDays = n;
  }
  if (input.scheduledMinutes !== undefined) {
    const n = Number(input.scheduledMinutes);
    if (!Number.isInteger(n) || n < 30 || n > 12 * 60) throw new LeaveError("1日の所定労働時間を正しく入力してください");
    data.scheduledMinutes = n;
  }
  return prisma.$transaction(async (tx) => {
    // 入社日を変えたら、自動で付与した分を作り直す(週の日数だけの変更は、これからの付与にだけ反映する)
    const hireChanged = data.hireDate !== undefined && (data.hireDate?.getTime() ?? null) !== (staff.hireDate?.getTime() ?? null);
    if (hireChanged) await tx.leaveGrant.deleteMany({ where: { staffId, auto: true } });
    return tx.staff.update({ where: { id: staffId }, data, select: { id: true, hireDate: true, weeklyDays: true, scheduledMinutes: true } });
  });
}

// 手で付与する(このシステムを使う前の残り、会社独自の特別休暇の上乗せなど)
export async function addGrant(companyId: string, input: { staffId?: unknown; grantDate?: unknown; days?: unknown; note?: unknown }) {
  const staff = await prisma.staff.findFirst({ where: { id: String(input.staffId ?? ""), companyId } });
  if (!staff) throw new LeaveError("スタッフを選んでください");
  const grantDate = toDate(input.grantDate, "付与日");
  if (grantDate > todayDate()) throw new LeaveError("付与日は今日までの日付にしてください");
  if (addMonths(grantDate, 12 * EXPIRE_YEARS) <= todayDate()) throw new LeaveError("2年より前の付与は時効のため登録できません");
  const halfDays = Number(input.days) * 2;
  if (!Number.isInteger(halfDays) || halfDays < 1 || halfDays > 80) throw new LeaveError("日数は0.5〜40日で入力してください(半日単位)");
  try {
    return await prisma.leaveGrant.create({
      data: { companyId, staffId: staff.id, grantDate, halfDays, auto: false, note: String(input.note ?? "").trim().slice(0, 100) || null },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new LeaveError("同じ日に手で付与した分があります。消してから入れ直してください");
    throw error;
  }
}

export async function deleteGrant(companyId: string, id: string) {
  const grant = await prisma.leaveGrant.findFirst({ where: { id, companyId } });
  if (!grant) throw new LeaveError("付与の記録が見つかりません");
  if (grant.auto) throw new LeaveError("自動で付与した分は消せません。入社日・週の日数を確かめてください");
  const { grants, taken } = await staffLeave(companyId, grant.staffId);
  const { shortage } = allocate(grants.filter((g) => g.id !== id), taken);
  if (shortage.size) throw new LeaveError("この付与はすでに取得に使われているため消せません");
  await prisma.leaveGrant.delete({ where: { id } });
  return grant;
}

async function assertMonthOpen(companyId: string, date: Date) {
  const month = dateKey(date).slice(0, 7);
  if (await prisma.payrollRun.findUnique({ where: { companyId_month: { companyId, month } } })) {
    throw new LeaveError(`${Number(month.slice(5))}月分の給料は計上済みです。「給与計算」で計上を取り消してから登録してください`);
  }
}

// 取得を登録する。kind: FULL(1日) / HALF(半日) / BULK(導入前に取った分をまとめて。給与には入れない)
export async function addTaken(companyId: string, input: { staffId?: unknown; date?: unknown; kind?: unknown; days?: unknown; note?: unknown }) {
  const staff = await prisma.staff.findFirst({ where: { id: String(input.staffId ?? ""), companyId } });
  if (!staff) throw new LeaveError("スタッフを選んでください");
  const date = toDate(input.date, "取得日");
  const kind = input.kind;
  if (kind !== "FULL" && kind !== "HALF" && kind !== "BULK") throw new LeaveError("1日・半日・まとめて のどれかを選んでください");
  const halfDays = kind === "FULL" ? 2 : kind === "HALF" ? 1 : Number(input.days) * 2;
  if (kind === "BULK" && (!Number.isInteger(halfDays) || halfDays < 1 || halfDays > 80)) throw new LeaveError("まとめて登録する日数は0.5〜40日で入力してください(半日単位)");
  if (kind === "BULK" && date > todayDate()) throw new LeaveError("まとめて登録するのは、これまでに取った分だけです(今日までの日付)");
  if (kind !== "BULK") {
    await assertMonthOpen(companyId, date);
    if (kind === "FULL") {
      const worked = await prisma.timeRecord.count({ where: { companyId, staffId: staff.id, date } });
      if (worked) throw new LeaveError("この日は出勤の打刻があります。半日の有給にするか、打刻を直してください");
    }
  }
  const { grants, taken } = await staffLeave(companyId, staff.id);
  const { shortage } = allocate(grants, [...taken, { id: "new", date, halfDays }]);
  if (shortage.has("new")) {
    const { pool } = allocate(grants, taken);
    const left = balanceOn(pool, date);
    throw new LeaveError(`有給の残りが足りません(${dateKey(date)} 時点の残り ${left / 2}日)。付与を確かめてください`);
  }
  try {
    return await prisma.leaveTaken.create({
      data: { companyId, staffId: staff.id, date, halfDays, bulk: kind === "BULK", note: String(input.note ?? "").trim().slice(0, 100) || null },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new LeaveError("この日はすでに有給の記録があります");
    throw error;
  }
}

export async function deleteTaken(companyId: string, id: string) {
  const taken = await prisma.leaveTaken.findFirst({ where: { id, companyId } });
  if (!taken) throw new LeaveError("取得の記録が見つかりません");
  if (!taken.bulk) await assertMonthOpen(companyId, taken.date);
  await prisma.leaveTaken.delete({ where: { id } });
  return taken;
}
