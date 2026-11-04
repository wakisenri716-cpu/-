import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { closureMap, isCompanyOpen } from "@/lib/companyClosures";
import { MailError, sendMail } from "@/lib/mail";
import { sendToUsers } from "@/lib/push";

// 当番表: 「掃除 月水金 山田・佐藤・鈴木」のように1行で決めると、その曜日の会社が開いている日(土日・祝日・会社の休業日を除く)に順番に回す。
// その日だけの入れかわりもでき、当番の日の朝に本人へメールとアプリの通知で知らせる。

const DAYS = "日月火水木金土";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (k: string) => new Date(`${k}T00:00:00Z`).getUTCDay();
type Me = { id: string; name: string; companyId: string; role: string };
const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";
const flat = (s: string) => s.replace(/\s/g, "");

async function members(companyId: string) {
  const rows = await prisma.companyMember.findMany({ where: { companyId, active: true, role: { not: "ADVISOR" } }, include: { user: { select: { id: true, name: true, email: true, active: true } } }, orderBy: { createdAt: "asc" } });
  return rows.filter((m) => m.user.active).map((m) => m.user);
}

// 曜日: 「月水金」「平日」「毎日」「月〜金」「月曜と木曜」
export function parseWeekdays(text: string): number[] {
  const t = text.normalize("NFKC");
  if (/平日|毎営業日/.test(t)) return [1, 2, 3, 4, 5];
  if (/毎日/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const range = t.match(/([日月火水木金土])(?:曜日?)?\s*[〜~ー-]\s*([日月火水木金土])/);
  if (range) {
    const a = DAYS.indexOf(range[1]);
    const b = DAYS.indexOf(range[2]);
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b || out.length > 7) break;
    }
    return out.sort();
  }
  const m = t.match(/[日月火水木金土](?=曜|[日月火水木金土・、と\s]|$)/g) ?? [];
  // 「毎週」の「日」や「当番」の字は数えない
  return [...new Set(m.map((d) => DAYS.indexOf(d)))].sort();
}

export type DutyDraft = { name: string; weekdays: number[]; memberIds: string[]; unknown: string[] };

export function templateDuty(line: string, people: { id: string; name: string }[]): DutyDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const name = (t.match(/^([^\s、,]+?)(?:当番)?(?=\s|、|,|$)/)?.[1] ?? "当番").replace(/当番$/, "").slice(0, 20) || "当番";
  const weekdays = parseWeekdays(t.replace(/^[^\s]+\s?/, " "));
  // メンバー: 名前(名字だけでもひとりに決まれば)を書いた順に
  const words = t.replace(/^[^\s]+\s?/, "").split(/[\s、,・/]+/).map((w) => w.replace(/(さん|様|くん|ちゃん)$/, "")).filter((w) => w.length >= 2 && !/^[日月火水木金土〜~ー-]+$|曜|平日|毎日|毎週|順番|交代|当番/.test(w));
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const w of words) {
    const exact = people.find((p) => flat(p.name) === flat(w));
    const hits = exact ? [exact] : people.filter((p) => flat(p.name).startsWith(flat(w)));
    if (hits.length === 1) {
      if (!ids.includes(hits[0].id)) ids.push(hits[0].id);
    } else unknown.push(w);
  }
  return { name, weekdays, memberIds: ids, unknown };
}

export async function parseDuty(companyId: string, text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("当番のことを書いてください(例: 掃除 月水金 山田・佐藤・鈴木)");
  return templateDuty(t, await members(companyId));
}

export async function saveDuty(me: Me, raw: Record<string, unknown>, id?: string) {
  if (!canManage(me.role)) throw new UserError("当番表は管理者・経理担当が決めます");
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
  if (!name) throw new UserError("当番の名前を入れてください");
  const weekdays = Array.isArray(raw.weekdays) ? [...new Set(raw.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (!weekdays.length) throw new UserError("曜日を選んでください");
  const people = await members(me.companyId);
  const memberIds = Array.isArray(raw.memberIds) ? [...new Set(raw.memberIds.map(String))].filter((x) => people.some((p) => p.id === x)) : [];
  if (!memberIds.length) throw new UserError("当番をする人を1人以上選んでください");
  const startDate = String(raw.startDate ?? "") || jstDateKey(new Date());
  if (!DATE.test(startDate)) throw new UserError("始める日を正しく入れてください");
  const data = { name, weekdays, memberIds, startDate, note: String(raw.note ?? "").trim().slice(0, 200) || null };
  if (id) {
    const { count } = await prisma.dutyRole.updateMany({ where: { id, companyId: me.companyId }, data });
    if (!count) throw new UserError("見つかりません");
    return prisma.dutyRole.findUniqueOrThrow({ where: { id } });
  }
  return prisma.dutyRole.create({ data: { companyId: me.companyId, ...data } });
}

export async function deleteDuty(me: Me, id: string) {
  if (!canManage(me.role)) throw new UserError("当番表は管理者・経理担当が決めます");
  const { count } = await prisma.dutyRole.deleteMany({ where: { id, companyId: me.companyId } });
  if (!count) throw new UserError("見つかりません");
}

// その日だけ入れかえる(userId が空なら元に戻す)
export async function swapDuty(me: Me, roleId: string, raw: Record<string, unknown>) {
  if (!canManage(me.role)) throw new UserError("入れかえは管理者・経理担当がします");
  const role = await prisma.dutyRole.findFirst({ where: { id: roleId, companyId: me.companyId } });
  if (!role) throw new UserError("見つかりません");
  const date = String(raw.date ?? "");
  if (!DATE.test(date) || date < jstDateKey(new Date())) throw new UserError("今日より後の日を選んでください");
  const userId = String(raw.userId ?? "");
  if (!userId) {
    await prisma.dutySwap.deleteMany({ where: { roleId, date } });
    return { ok: true };
  }
  if (!(await members(me.companyId)).some((p) => p.id === userId)) throw new UserError("社内の人を選んでください");
  await prisma.dutySwap.upsert({ where: { roleId_date: { roleId, date } }, create: { roleId, date, userId, byName: me.name }, update: { userId, byName: me.name } });
  return { ok: true };
}

type Role = { id: string; name: string; weekdays: number[]; memberIds: string[]; startDate: string; swaps: { date: string; userId: string }[] };

// from から days 日分の当番(会社が開いている、決めた曜日の日だけ)
export function scheduleOf(role: Role, from: string, days: number, closures: Map<string, string>) {
  const out: { date: string; userId: string; swapped: boolean }[] = [];
  if (!role.memberIds.length) return out;
  const until = addDays(from, days - 1);
  let n = 0;
  // 始めた日から数えて、何回目の当番の日か
  for (let d = role.startDate, guard = 0; d <= until && guard < 4000; d = addDays(d, 1), guard++) {
    if (!role.weekdays.includes(weekday(d)) || !isCompanyOpen(d, closures)) continue;
    if (d >= from) {
      const swap = role.swaps.find((s) => s.date === d);
      out.push({ date: d, userId: swap?.userId ?? role.memberIds[n % role.memberIds.length], swapped: !!swap });
    }
    n++;
  }
  return out;
}

export async function listDuties(companyId: string, days = 14) {
  const today = jstDateKey(new Date());
  const [roles, people, closures] = await Promise.all([prisma.dutyRole.findMany({ where: { companyId, active: true }, include: { swaps: { where: { date: { gte: today } } } }, orderBy: { createdAt: "asc" } }), members(companyId), closureMap(companyId, today)]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "(いない人)";
  return {
    today,
    people: people.map((p) => ({ id: p.id, name: p.name })),
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      weekdays: r.weekdays,
      weekdayLabel: r.weekdays.map((d) => DAYS[d]).join(""),
      members: r.memberIds.map((id) => ({ id, name: nameOf(id) })),
      startDate: r.startDate,
      note: r.note,
      schedule: scheduleOf(r, today, days, closures).map((s) => ({ ...s, name: nameOf(s.userId) })),
    })),
  };
}

// 自分の当番(これから2週間)
export async function myDuties(me: { id: string; companyId: string }) {
  const d = await listDuties(me.companyId, 14);
  return d.roles.flatMap((r) => r.schedule.filter((s) => s.userId === me.id).map((s) => ({ role: r.name, date: s.date, today: s.date === d.today, note: r.note }))).sort((a, b) => a.date.localeCompare(b.date));
}

// 毎朝: 今日の当番の人にメールとアプリの通知
export async function remindDutiesToday() {
  const today = jstDateKey(new Date());
  const companies = await prisma.dutyRole.findMany({ where: { active: true }, select: { companyId: true }, distinct: ["companyId"] });
  let sent = 0;
  for (const { companyId } of companies) {
    const d = await listDuties(companyId, 1);
    const people = await members(companyId);
    for (const r of d.roles) {
      for (const s of r.schedule.filter((x) => x.date === today)) {
        const p = people.find((x) => x.id === s.userId);
        if (!p) continue;
        // 同じ日に二度送らない
        if (await prisma.emailLog.count({ where: { companyId, relatedId: `${r.id}:${today}` } })) continue;
        if (p.email) {
          try {
            await sendMail({ companyId, kind: "NOTICE", to: p.email, subject: `【当番】今日は${r.name}の当番です`, text: `${p.name}さん\n\n今日(${Number(today.slice(5, 7))}月${Number(today.slice(8))}日)は${r.name}の当番です。${r.note ? `\n${r.note}` : ""}\nよろしくお願いします。\n`, sentByName: "システム", relatedId: `${r.id}:${today}` });
            sent++;
          } catch (error) {
            if (!(error instanceof MailError)) throw error;
          }
        }
        await sendToUsers([p.id], { title: `今日は${r.name}の当番です`, body: r.note ?? "よろしくお願いします", url: "/staff/duties" }).catch(() => null);
      }
    }
  }
  return sent;
}
