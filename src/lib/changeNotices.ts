import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { MailError, sendMail } from "@/lib/mail";
import type { Profile } from "@/lib/staffRecords";

// 身上の変更の届け出: 従業員が「引っ越しました 〒123-4567 東京都…」のように住所・電話・名前・緊急連絡先の変更を届け、
// 総務が確かめて労働者名簿に入れる。入れたあと、あわせて確かめること(通勤手当・社会保険など)を出す。
// 振込先の口座の変更は、まちがえると給与が届かないので、ここでは受けず総務に直接伝えてもらう。

export const KINDS = { ADDRESS: "住所", PHONE: "電話番号", NAME: "名前", EMERGENCY: "緊急連絡先" } as const;
export type Kind = keyof typeof KINDS;
export const FOLLOW_UPS: Record<Kind, string[]> = {
  ADDRESS: ["通勤の道のりが変わるので、通勤手当を見直す", "社会保険(健康保険・厚生年金)の住所の届けが要るか確かめる", "年末調整・住民税で使う住所を直す"],
  PHONE: [],
  NAME: ["健康保険・厚生年金・雇用保険の名前を変える届けを出す", "給与の振込先の名前が変わるか確かめる", "名刺・社員証・メールの表示名を直す"],
  EMERGENCY: [],
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /0\d{1,4}-?\d{1,4}-?\d{3,4}/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
type Values = { address?: string | null; phone?: string | null; name?: string | null; kana?: string | null; emergencyName?: string | null; emergencyPhone?: string | null; emergencyRelation?: string | null };

// 1行を分ける(何も保存しない)
export function templateNotice(line: string) {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const values: Values = {};
  let kind: Kind = "ADDRESS";
  if (/緊急連絡先|緊急の連絡/.test(t)) {
    kind = "EMERGENCY";
    values.emergencyPhone = t.match(PHONE)?.[0] ?? null;
    values.emergencyRelation = t.match(/(父|母|夫|妻|兄|姉|弟|妹|祖父|祖母|息子|娘|配偶者|親|子)/)?.[1] ?? null;
    values.emergencyName = t.replace(/緊急連絡先(を|は|が)?|緊急の連絡(先)?|変わりました|(に)?変更(します|しました)?|に?なります/g, " ").replace(PHONE, " ").replace(/\((父|母|夫|妻|兄|姉|弟|妹|祖父|祖母|息子|娘|配偶者|親|子)\)|(父|母|夫|妻|兄|姉|弟|妹|祖父|祖母|息子|娘|配偶者)の?/g, " ").replace(/\s+/g, " ").trim().replace(/\s?(に|を|へ|です)$/, "").slice(0, 30) || null;
  } else if (/結婚|旧姓|名字|苗字|姓が|氏名|名前が/.test(t)) {
    kind = "NAME";
    // 「新しい名前 佐藤 花子」「名前は佐藤 花子」(「名前が変わりました」の「変わりました」は名前にしない)
    const nameRe = /(?:新しい名前|新しい氏名|新姓)\s*[はがを:：]?\s*([\p{sc=Han}\p{sc=Katakana}ー]{1,8}\s?[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]{1,8})|(?:名前|氏名)\s*[は:：]\s*([\p{sc=Han}\p{sc=Katakana}ー]{1,8}\s?[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]{1,8})/u;
    const nm = t.match(nameRe);
    values.name = (nm?.[1] ?? nm?.[2] ?? null)?.replace(/[((].*$/, "").replace(/(に変わりました|になりました|に変わります|になります|です)$/, "").trim() ?? null;
    values.kana = t.match(/[((]([\p{sc=Hiragana}ー]+\s?[\p{sc=Hiragana}ー]+)[))]/u)?.[1] ?? null;
  } else if (!/〒|都|道|府|県|市|区|町|村/.test(t) && PHONE.test(t)) {
    kind = "PHONE";
    values.phone = t.match(PHONE)?.[0] ?? null;
  } else {
    // 住所: 〒 か 都道府県から後ろ(電話は外す)
    const from = t.search(/〒|\d{3}-\d{4}|(東京都|北海道|大阪府|京都府|\S{2,3}県)/);
    values.address = from >= 0 ? t.slice(from).replace(PHONE, " ").replace(/(電話(番号)?|TEL|Tel|tel|携帯)\s*[:：]?/g, " ").replace(/(に|へ)?(引っ越し(ました)?|転居(しました)?|移りました)/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : null;
    const phone = t.match(PHONE)?.[0];
    if (phone && !values.address?.includes(phone)) values.phone = phone;
  }
  const dateM = t.match(/(\d{1,2})\/(\d{1,2})|(\d{1,2})月(\d{1,2})日/);
  let effectiveOn: string | null = null;
  if (dateM) {
    const y = Number(jstDateKey(new Date()).slice(0, 4));
    const mo = Number(dateM[1] ?? dateM[3]);
    const d = Number(dateM[2] ?? dateM[4]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) effectiveOn = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return { kind, values, effectiveOn };
}

export async function parseNotice(text: string) {
  const t = String(text ?? "").trim().slice(0, 300);
  if (!t) throw new UserError("変わったことを書いてください(例: 11/1に引っ越しました 〒123-4567 東京都…)");
  if (/口座|振込先|銀行/.test(t)) throw new UserError("給与の振込先の口座の変更は、まちがいがないよう総務に直接伝えてください");
  return templateNotice(t);
}

function cleanValues(kind: Kind, raw: Record<string, unknown>): Values {
  const v = (raw.values ?? {}) as Record<string, unknown>;
  if (kind === "ADDRESS") {
    const address = clean(v.address, 120);
    if (!address) throw new UserError("新しい住所を入れてください");
    return { address, phone: clean(v.phone, 20) };
  }
  if (kind === "PHONE") {
    const phone = clean(v.phone, 20);
    if (!phone || !/^[0-9+\-() ]{9,20}$/.test(phone)) throw new UserError("新しい電話番号を入れてください");
    return { phone };
  }
  if (kind === "NAME") {
    const name = clean(v.name, 40);
    if (!name) throw new UserError("新しい名前を入れてください");
    return { name, kana: clean(v.kana, 60) };
  }
  const emergencyName = clean(v.emergencyName, 40);
  const emergencyPhone = clean(v.emergencyPhone, 20);
  if (!emergencyName || !emergencyPhone) throw new UserError("緊急連絡先の名前と電話番号を入れてください");
  return { emergencyName, emergencyPhone, emergencyRelation: clean(v.emergencyRelation, 10) };
}

export async function submitNotice(me: { id: string; name: string; companyId: string }, raw: Record<string, unknown>) {
  const kind: Kind = typeof raw.kind === "string" && raw.kind in KINDS ? (raw.kind as Kind) : "ADDRESS";
  const values = cleanValues(kind, raw);
  const effectiveOn = String(raw.effectiveOn ?? "").trim() || null;
  if (effectiveOn && !DATE.test(effectiveOn)) throw new UserError("変わった日を正しく入れてください");
  const staff = await prisma.staff.findFirst({ where: { companyId: me.companyId, userId: me.id }, select: { id: true } });
  const row = await prisma.changeNotice.create({ data: { companyId: me.companyId, userId: me.id, userName: me.name, staffId: staff?.id ?? null, kind, values: values as Prisma.InputJsonValue, effectiveOn, note: clean(raw.note, 200) } });
  const admins = await prisma.companyMember.findMany({ where: { companyId: me.companyId, active: true, role: { in: ["ADMIN", "ACCOUNTANT"] } }, include: { user: { select: { email: true, name: true, active: true } } } });
  for (const a of admins.filter((x) => x.user.active && x.user.email && x.userId !== me.id)) {
    try {
      await sendMail({ companyId: me.companyId, kind: "NOTICE", to: a.user.email, subject: `【届け出】${me.name}さんの${KINDS[kind]}が変わりました`, text: `${a.user.name}さん\n\n${me.name}さんから、${KINDS[kind]}の変更の届け出が届きました${effectiveOn ? `(${effectiveOn}から)` : ""}。\nClerklyの「身上の変更の届け出」で確かめて、名簿に入れてください。\n`, sentByName: me.name, relatedId: row.id });
    } catch (error) {
      if (!(error instanceof MailError)) throw error;
    }
  }
  return row;
}

export async function myNotices(me: { id: string; companyId: string }) {
  return prisma.changeNotice.findMany({ where: { companyId: me.companyId, userId: me.id }, orderBy: { createdAt: "desc" }, take: 20 });
}

export async function listNotices(companyId: string) {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const rows = await prisma.changeNotice.findMany({ where: { companyId, OR: [{ status: "REQUESTED" }, { updatedAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 200 });
  const staffIds = rows.map((r) => r.staffId).filter((x): x is string => !!x);
  const staff = staffIds.length ? await prisma.staff.findMany({ where: { companyId, id: { in: staffIds } }, select: { id: true, name: true, profile: true } }) : [];
  return rows.map((r) => {
    const s = staff.find((x) => x.id === r.staffId);
    const p = (s?.profile ?? {}) as Profile;
    return { ...r, kindLabel: KINDS[r.kind as Kind] ?? r.kind, current: s ? { name: s.name, address: p.address ?? null, phone: p.phone ?? null, kana: p.kana ?? null, emergencyName: p.emergencyName ?? null, emergencyPhone: p.emergencyPhone ?? null } : null, followUps: FOLLOW_UPS[r.kind as Kind] ?? [] };
  });
}

// 総務: 名簿に入れる / 見送る(理由)
export async function decideNotice(me: { companyId: string; name: string; role: string }, id: string, raw: Record<string, unknown>) {
  if (me.role !== "ADMIN" && me.role !== "ACCOUNTANT") throw new UserError("届け出は管理者・経理担当が扱います");
  const n = await prisma.changeNotice.findFirst({ where: { id, companyId: me.companyId } });
  if (!n || n.status !== "REQUESTED") throw new UserError("届け出が見つからないか、もう扱いが済んでいます");
  if (raw.action === "reject") {
    const reply = clean(raw.reply, 200);
    if (!reply) throw new UserError("理由を書いてください");
    await prisma.changeNotice.update({ where: { id }, data: { status: "REJECTED", reply, decidedByName: me.name } });
    await tell(me, n, `届け出は確かめが必要なため、まだ名簿に入れていません(${reply})`);
    return { followUps: [] as string[] };
  }
  if (raw.action !== "apply") throw new UserError("することがわかりません");
  if (!n.staffId) throw new UserError("この人のスタッフ登録が見つかりません。先にスタッフとログインをひも付けてください");
  const staff = await prisma.staff.findFirst({ where: { id: n.staffId, companyId: me.companyId } });
  if (!staff) throw new UserError("スタッフが見つかりません");
  const v = n.values as Values;
  const profile = { ...((staff.profile ?? {}) as Profile) };
  let newName: string | undefined;
  if (n.kind === "ADDRESS") {
    profile.address = v.address ?? profile.address;
    if (v.phone) profile.phone = v.phone;
  } else if (n.kind === "PHONE") profile.phone = v.phone ?? profile.phone;
  else if (n.kind === "NAME") {
    newName = v.name ?? undefined;
    if (v.kana) profile.kana = v.kana;
    if (newName && newName !== staff.name && (await prisma.staff.count({ where: { companyId: me.companyId, name: newName, id: { not: staff.id } } }))) throw new UserError("同じ名前のスタッフがいます。名簿で名前を少し変えてから入れてください");
  } else {
    profile.emergencyName = v.emergencyName ?? undefined;
    profile.emergencyPhone = v.emergencyPhone ?? undefined;
    profile.emergencyRelation = v.emergencyRelation ?? undefined;
  }
  await prisma.$transaction([
    prisma.staff.update({ where: { id: staff.id }, data: { profile: JSON.parse(JSON.stringify(profile)) as Prisma.InputJsonValue, ...(newName ? { name: newName } : {}) } }),
    prisma.changeNotice.update({ where: { id }, data: { status: "APPLIED", decidedByName: me.name } }),
  ]);
  await tell(me, n, `届け出た${KINDS[n.kind as Kind]}を名簿に入れました`);
  return { followUps: FOLLOW_UPS[n.kind as Kind] ?? [] };
}

async function tell(me: { companyId: string; name: string }, n: { id: string; userId: string; userName: string; kind: string }, text: string) {
  const u = await prisma.user.findFirst({ where: { id: n.userId, active: true }, select: { email: true } });
  if (!u?.email) return;
  try {
    await sendMail({ companyId: me.companyId, kind: "NOTICE", to: u.email, subject: `【届け出】${KINDS[n.kind as Kind] ?? ""}の変更`, text: `${n.userName}さん\n\n${text}。\n`, sentByName: me.name, relatedId: n.id });
  } catch (error) {
    if (!(error instanceof MailError)) throw error;
  }
}

export async function countNotices(companyId: string) {
  return prisma.changeNotice.count({ where: { companyId, status: "REQUESTED" } });
}
