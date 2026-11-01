import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { lastOdometers, listChecks, pairTrips } from "@/lib/alcoholChecks";

// 社用車の管理: 予約できるもの(社用車)ごとに、ナンバー・車検と任意保険の満了日・次の点検のメーターを持ち、
// 期限が近いもの・点検のメーターに近づいたものを知らせる。いまのメーターと今月の距離は運転日誌から出す。

export const DUE_SOON_DAYS = 30;
export const SERVICE_SOON_KM = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

export type VehicleAlert = { kind: "INSPECTION" | "INSURANCE" | "SERVICE"; text: string; overdue: boolean };

export function vehicleAlerts(v: { name: string; inspectionDue: string | null; insuranceDue: string | null; serviceAtKm: number | null }, today: string, km: number | null): VehicleAlert[] {
  const out: VehicleAlert[] = [];
  const md = (k: string) => `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
  for (const [kind, label, due] of [
    ["INSPECTION", "車検", v.inspectionDue],
    ["INSURANCE", "任意保険", v.insuranceDue],
  ] as const) {
    if (!due) continue;
    const d = daysUntil(due, today);
    if (d < 0) out.push({ kind, text: `${label}が${md(due)}に切れています`, overdue: true });
    else if (d <= DUE_SOON_DAYS) out.push({ kind, text: `${label}の満了日(${md(due)})まであと${d}日です`, overdue: false });
  }
  if (v.serviceAtKm != null && km != null) {
    const left = v.serviceAtKm - km;
    if (left <= 0) out.push({ kind: "SERVICE", text: `点検のメーター(${v.serviceAtKm.toLocaleString()}km)を${(-left).toLocaleString()}km過ぎています`, overdue: true });
    else if (left <= SERVICE_SOON_KM) out.push({ kind: "SERVICE", text: `点検のメーター(${v.serviceAtKm.toLocaleString()}km)まであと${left.toLocaleString()}kmです`, overdue: false });
  }
  return out;
}

export async function listVehicles(companyId: string) {
  const today = jstDateKey(new Date());
  const [cars, km, checks] = await Promise.all([
    prisma.facility.findMany({ where: { companyId, kind: "CAR", active: true }, orderBy: { name: "asc" } }),
    lastOdometers(companyId),
    listChecks(companyId, `${today.slice(0, 7)}-01`, today),
  ]);
  const trips = pairTrips(checks);
  return cars.map((c) => {
    const odometer = km[c.name] ?? null;
    const mine = trips.filter((t) => t.vehicle === c.name);
    return {
      id: c.id,
      name: c.name,
      plate: c.plate,
      inspectionDue: c.inspectionDue,
      insuranceDue: c.insuranceDue,
      serviceAtKm: c.serviceAtKm,
      odometer,
      monthTrips: mine.length,
      monthKm: mine.reduce((s, t) => s + (t.distance ?? 0), 0),
      alerts: vehicleAlerts(c, today, odometer),
    };
  });
}

export async function countVehicleAlerts(companyId: string) {
  return (await listVehicles(companyId)).filter((v) => v.alerts.length).length;
}

const dateOrNull = (v: unknown, label: string) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${label}を正しく入れてください`);
  return s;
};

export async function saveVehicle(user: { companyId: string; role: string }, id: string, raw: Record<string, unknown>) {
  if (user.role !== "ADMIN" && user.role !== "ACCOUNTANT") throw new UserError("社用車の情報は管理者・経理担当が直せます");
  const car = await prisma.facility.findFirst({ where: { id, companyId: user.companyId, kind: "CAR", active: true } });
  if (!car) throw new UserError("社用車が見つかりません");
  const kmRaw = String(raw.serviceAtKm ?? "").normalize("NFKC").replace(/[,\s]|km/gi, "");
  if (kmRaw && !/^\d{1,7}$/.test(kmRaw)) throw new UserError("点検のメーターは km の数字で入れてください");
  return prisma.facility.update({
    where: { id },
    data: {
      plate: String(raw.plate ?? "").replace(/\s+/g, " ").trim().slice(0, 30) || null,
      inspectionDue: dateOrNull(raw.inspectionDue, "車検の満了日"),
      insuranceDue: dateOrNull(raw.insuranceDue, "任意保険の満了日"),
      serviceAtKm: kmRaw ? Number(kmRaw) : null,
    },
  });
}
