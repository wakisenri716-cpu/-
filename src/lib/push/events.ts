import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { companyMemberIds, notifyLater } from "./index";

// どんなときに通知を送るか(送る先と文面)

const WEEKDAYS = "日月火水木金土";
const hhmm = (m: number) => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, "0")}`;
const dayLabel = (d: Date) => {
  const key = jstDateKey(d);
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8))}(${WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]})`;
};
const shiftsUrl = (d: Date) => `/staff/shifts?tab=confirmed&month=${jstDateKey(d).slice(0, 7)}`;

async function staffUser(staffId: string) {
  return (await prisma.staff.findUnique({ where: { id: staffId }, select: { userId: true } }))?.userId ?? null;
}

type ShiftLike = { staffId: string; date: Date; startMinutes: number; endMinutes: number };

// シフトを1つ入れた・変えた・消した
export function notifyShift(kind: "created" | "updated" | "deleted", shift: ShiftLike) {
  const title = { created: "シフトが入りました", updated: "シフトが変わりました", deleted: "シフトがなくなりました" }[kind];
  notifyLater(
    async () => {
      const userId = await staffUser(shift.staffId);
      return userId ? [userId] : [];
    },
    { title, body: kind === "deleted" ? `${dayLabel(shift.date)} のシフトは取り消されました` : `${dayLabel(shift.date)} ${hhmm(shift.startMinutes)}〜${hhmm(shift.endMinutes)}`, url: shiftsUrl(shift.date) },
  );
}

// まとめてシフトを作った(前の週の写し・シフト希望から): スタッフごとに件数を知らせる
export function notifyShiftsBulk(companyId: string, created: { staffId: string; date: Date }[]) {
  if (!created.length) return;
  const byStaff = new Map<string, Date[]>();
  for (const s of created) byStaff.set(s.staffId, [...(byStaff.get(s.staffId) ?? []), s.date]);
  for (const [staffId, dates] of byStaff) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    notifyLater(
      async () => {
        const userId = await staffUser(staffId);
        return userId ? [userId] : [];
      },
      { title: "シフトが決まりました", body: `${dayLabel(dates[0])}から${dates.length}日分のシフトが入りました。アプリで確かめてください`, url: shiftsUrl(dates[0]) },
    );
  }
  void companyId;
}

export function notifyAnnouncement(companyId: string, authorId: string, announcement: { title: string }) {
  notifyLater(() => companyMemberIds(companyId, authorId), { title: "社内のお知らせ", body: announcement.title, url: "/notices" });
}

export function notifyManual(companyId: string, authorId: string | undefined, manual: { id: string; title: string; published: boolean }, kind: "new" | "updated") {
  if (!manual.published) return;
  notifyLater(() => companyMemberIds(companyId, authorId), {
    title: kind === "new" ? "新しいマニュアル" : "マニュアルが更新されました",
    body: `${manual.title}(読んだら「読みました」を押してください)`,
    url: `/staff/manuals/${manual.id}`,
  });
}

// 申請(有給・稟議など)が承認・却下されたら申請した人に
export function notifyRequestDecided(companyId: string, number: string, status: string) {
  if (status !== "APPROVED" && status !== "REJECTED") return;
  notifyLater(
    async () => {
      const req = await prisma.approvalRequest.findFirst({ where: { companyId, number }, select: { requesterId: true } });
      return req ? [req.requesterId] : [];
    },
    async () => {
      const req = await prisma.approvalRequest.findFirst({ where: { companyId, number }, select: { title: true } });
      return req ? { title: status === "APPROVED" ? "申請が承認されました" : "申請が却下されました", body: req.title, url: "/requests" } : null;
    },
  );
}
