import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { memoContext } from "@/lib/phoneMemos";
import { matchMember } from "@/lib/teamTasks";
import { MailError, sendMail } from "@/lib/mail";

// 社員の資格・免許: 「山田 花子 普通自動車免許 2028/3/31まで」のように1行で記録し、有効期限の60日前から知らせる。
// 社用車を運転した人(アルコールチェックの記録)で、運転免許が記録されていない・切れている人も知らせる。

export const SOON_DAYS = 60;
// 運転免許とみなす名前
export const DRIVING = /運転免許|自動車免許|(普通|準中型|中型|大型|二種|二輪|原付)(自動車)?免許/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
const KNOWN = /(普通|準中型|中型|大型|二種|第二種)?(自動車|自動二輪|原付)?運転免許|(普通|準中型|中型|大型)(自動車)?免許|フォークリフト(運転技能講習)?|玉掛け|クレーン|危険物取扱者(甲種|乙種\d類?|丙種)?|衛生管理者|第[一二]種衛生管理者|宅地建物取引士|宅建|調理師|食品衛生責任者|防火管理者|電気工事士|簿記\d級|日商簿記\d級|社会保険労務士|税理士|行政書士|看護師|介護福祉士|保育士|安全運転管理者/;

// 日付: 2028/3/31・2028-03-31・2028年3月31日・令和10年3月31日・R10.3.31
export function parseDateText(text: string): string | null {
  const t = text.normalize("NFKC");
  let m = t.match(/(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/);
  let y: number | null = null;
  let mo = 0;
  let d = 0;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = t.match(/(?:令和|R)\s*(\d{1,2}|元)[年.\-/](\d{1,2})[月.\-/](\d{1,2})日?/i))) [y, mo, d] = [2018 + (m[1] === "元" ? 1 : Number(m[1])), Number(m[2]), Number(m[3])];
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const key = `${y}-${pad(mo)}-${pad(d)}`;
  return new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key ? key : null;
}

export type LicenseDraft = { holderUserId: string | null; holderName: string; name: string; kind: "DRIVING" | "OTHER"; number: string | null; expiresOn: string | null };

export function templateLicense(line: string, users: { id: string; name: string }[]): LicenseDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const expiresOn = parseDateText(t);
  const known = t.match(KNOWN)?.[0] ?? null;
  // 名前: 社内の人の名前が入っていればその人
  const member = users.find((u) => t.replace(/\s/g, "").includes(u.name.replace(/\s/g, ""))) ?? matchMember(users as never, t.split(" ")[0]) ?? null;
  const numberM = t.match(/(?:番号|No\.?|#)\s*:?\s*([\w-]{3,20})/i);
  let rest = t;
  for (const s of [member?.name, ...(member ? member.name.split(" ") : [])]) if (s) rest = rest.replace(s, " ");
  rest = rest
    .replace(numberM?.[0] ?? "\u0000", " ")
    .replace(/(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?|(?:令和|R)\s*(\d{1,2}|元)[年.\-/](\d{1,2})[月.\-/](\d{1,2})日?/gi, " ")
    .replace(/(まで|までの|有効期限|期限|有効|満了|が|の|は|を)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const holderName = member?.name ?? (known ? t.slice(0, t.indexOf(known)).replace(/[のはが]\s*$/, "").trim() : "") ?? "";
  const name = known ?? rest.replace(holderName, "").trim().slice(0, 40);
  return { holderUserId: member?.id ?? null, holderName: holderName.slice(0, 40), name: name || "", kind: DRIVING.test(name) ? "DRIVING" : "OTHER", number: numberM?.[1] ?? null, expiresOn };
}

export async function parseLicense(companyId: string, text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("資格・免許のことを書いてください(例: 山田 花子 普通自動車免許 2028/3/31まで)");
  const ctx = await memoContext(companyId);
  return templateLicense(t, ctx.users);
}

export async function saveLicense(user: { companyId: string; name: string; role: string }, raw: Record<string, unknown>, id?: string) {
  if (user.role !== "ADMIN" && user.role !== "ACCOUNTANT") throw new UserError("資格・免許の記録は管理者・経理担当がします");
  const ctx = await memoContext(user.companyId);
  const holderUserId = typeof raw.holderUserId === "string" && raw.holderUserId ? raw.holderUserId : null;
  const member = holderUserId ? ctx.users.find((u) => u.id === holderUserId) : null;
  if (holderUserId && !member) throw new UserError("社内の人が見つかりません");
  const holderName = member?.name ?? String(raw.holderName ?? "").trim().slice(0, 40);
  if (!holderName) throw new UserError("持っている人を選んでください");
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) throw new UserError("資格・免許の名前を入れてください");
  const date = (v: unknown, label: string) => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${label}を正しく入れてください`);
    return s;
  };
  const data = {
    holderUserId: member?.id ?? null,
    holderName,
    name,
    kind: raw.kind === "DRIVING" || DRIVING.test(name) ? "DRIVING" : "OTHER",
    number: String(raw.number ?? "").trim().slice(0, 20) || null,
    expiresOn: date(raw.expiresOn, "有効期限"),
    checkedOn: date(raw.checkedOn, "確かめた日"),
    note: String(raw.note ?? "").trim().slice(0, 200) || null,
  };
  if (id) {
    const { count } = await prisma.staffLicense.updateMany({ where: { id, companyId: user.companyId }, data });
    if (!count) throw new UserError("見つかりません");
    return prisma.staffLicense.findUniqueOrThrow({ where: { id } });
  }
  return prisma.staffLicense.create({ data: { companyId: user.companyId, ...data, createdByName: user.name } });
}

export async function deleteLicense(user: { companyId: string; role: string }, id: string) {
  if (user.role !== "ADMIN" && user.role !== "ACCOUNTANT") throw new UserError("資格・免許の記録は管理者・経理担当がします");
  const { count } = await prisma.staffLicense.deleteMany({ where: { id, companyId: user.companyId } });
  if (!count) throw new UserError("見つかりません");
}

const status = (expiresOn: string | null, today: string) => {
  if (!expiresOn) return { state: "OK" as const, days: null };
  const d = daysUntil(expiresOn, today);
  return { state: d < 0 ? ("EXPIRED" as const) : d <= SOON_DAYS ? ("SOON" as const) : ("OK" as const), days: d };
};

// 一覧と知らせ。社用車を運転した人(この90日のアルコールチェックの記録)で、運転免許の記録がない・切れている人も出す
export async function listLicenses(companyId: string) {
  const today = jstDateKey(new Date());
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const [rows, drivers] = await Promise.all([
    prisma.staffLicense.findMany({ where: { companyId }, orderBy: [{ expiresOn: "asc" }, { holderName: "asc" }] }),
    prisma.alcoholCheck.findMany({ where: { companyId, date: { gte: since } }, select: { driverName: true, driverId: true }, distinct: ["driverName"] }),
  ]);
  const licenses = rows.map((r) => ({ ...r, ...status(r.expiresOn, today) })).sort((a, b) => (a.state === b.state ? 0 : a.state === "EXPIRED" ? -1 : b.state === "EXPIRED" ? 1 : a.state === "SOON" ? -1 : b.state === "SOON" ? 1 : 0));
  const flat = (s: string) => s.replace(/\s/g, "");
  const driving = licenses.filter((l) => l.kind === "DRIVING");
  const unlicensedDrivers = drivers
    .map((d) => {
      const own = driving.filter((l) => (d.driverId && l.holderUserId === d.driverId) || flat(l.holderName) === flat(d.driverName));
      if (!own.length) return { name: d.driverName, reason: "運転免許の記録がありません" };
      if (own.every((l) => l.state === "EXPIRED")) return { name: d.driverName, reason: "運転免許の有効期限が切れています" };
      return null;
    })
    .filter((x): x is { name: string; reason: string } => !!x);
  return { licenses, unlicensedDrivers };
}

export async function countLicenseAlerts(companyId: string) {
  const { licenses, unlicensedDrivers } = await listLicenses(companyId);
  return licenses.filter((l) => l.state !== "OK").length + unlicensedDrivers.length;
}

// ---- 従業員が自分で登録する・期限のお知らせ ----

// 自分の資格・免許
export async function myLicenses(me: { id: string; companyId: string }) {
  const today = jstDateKey(new Date());
  const rows = await prisma.staffLicense.findMany({ where: { companyId: me.companyId, holderUserId: me.id }, orderBy: [{ expiresOn: "asc" }, { name: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, number: r.number, expiresOn: r.expiresOn, checkedOn: r.checkedOn, ...status(r.expiresOn, today) }));
}

// 従業員が自分の資格・免許を登録する・更新する(原本を確かめるのは総務)
export async function saveOwnLicense(me: { id: string; name: string; companyId: string }, raw: Record<string, unknown>, id?: string) {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) throw new UserError("資格・免許の名前を入れてください");
  const expiresOn = String(raw.expiresOn ?? "").trim() || null;
  if (expiresOn && (!DATE.test(expiresOn) || Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`)))) throw new UserError("有効期限を正しく入れてください");
  const data = { name, kind: DRIVING.test(name) ? "DRIVING" : "OTHER", number: String(raw.number ?? "").trim().slice(0, 20) || null, expiresOn };
  if (id) {
    const own = await prisma.staffLicense.findFirst({ where: { id, companyId: me.companyId, holderUserId: me.id } });
    if (!own) throw new UserError("見つかりません");
    // 期限が変わったら、総務の確認はやり直し
    return prisma.staffLicense.update({ where: { id }, data: { ...data, checkedOn: own.expiresOn === expiresOn ? own.checkedOn : null } });
  }
  return prisma.staffLicense.create({ data: { companyId: me.companyId, holderUserId: me.id, holderName: me.name, ...data, createdByName: me.name } });
}

// 毎朝: 有効期限まで30日以内の資格・免許を、持っている本人にメールで知らせる(同じ期限で一度だけ)
export async function remindExpiringLicenses(baseUrl: string) {
  const today = jstDateKey(new Date());
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = await prisma.staffLicense.findMany({ where: { expiresOn: { gte: today, lte: until }, holderUserId: { not: null } } });
  let sent = 0;
  for (const r of rows.filter((x) => x.remindedFor !== x.expiresOn)) {
    const user = await prisma.user.findFirst({ where: { id: r.holderUserId!, active: true }, select: { email: true } });
    if (!user?.email) continue;
    try {
      await sendMail({ companyId: r.companyId, kind: "NOTICE", to: user.email, subject: `【資格・免許】${r.name}の有効期限が近づいています`, text: `${r.holderName}さん\n\n${r.name}の有効期限は ${r.expiresOn} です(あと${daysUntil(r.expiresOn!, today)}日)。\n更新したら、Clerkly従業員用の「資格・免許」で新しい期限を入れてください。総務が新しい免許証などを確かめます。\n\n資格・免許: ${baseUrl}/staff/licenses\n`, sentByName: "システム", relatedId: r.id });
      await prisma.staffLicense.update({ where: { id: r.id }, data: { remindedFor: r.expiresOn } });
      sent++;
    } catch (error) {
      if (!(error instanceof MailError)) throw error;
    }
  }
  return sent;
}
