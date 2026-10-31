import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { normalizeName } from "@/lib/partyMerge";
import { MailError, appUrl, sendMail } from "@/lib/mail";
import { findMember, findParty, memoContext } from "@/lib/phoneMemos";
import { matchMember, relativeDue } from "@/lib/teamTasks";
import { parseTimeRange, validHM } from "@/lib/bookingText";

// 来客の受付簿: 「明日14時 さくら商事 佐藤様 山田さん宛 打ち合わせ」のように1行で予定を入れる。
// お見えになったら「お見えになった」を押すと担当の人にメールで知らせる。同じ日・同じ相手の会議室の予約があれば並べて出す。

export type VisitorDraft = { date: string; time: string | null; visitorName: string; visitorCompany: string | null; partyKind: "customer" | "vendor" | null; partyId: string | null; hostUserId: string | null; purpose: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => {
  const s = String(v ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
};
const DATE_WORD = /^(今日|本日|明日|あした|明後日|あさって|午前|午後|(今週|来週|再来週)?の?[月火水木金土日]曜日?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}(:\d{2}|時.*))$/;

// 1行を分ける(何も保存しない)
export function templateVisitor(line: string, ctx: Awaited<ReturnType<typeof memoContext>>, today: string): VisitorDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const date = relativeDue(t, today) ?? today;
  const time = parseTimeRange(t)?.start ?? null;
  // 担当: 「山田さん宛」「山田さんに」「担当 山田」「担当は山田さん」
  const hostWord =
    t.match(/([\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}ー]{1,8}?)\s?(?:さん|部長|課長|係長|主任|社長)?\s?(?:宛て?|あて|へ|に面会|に会い|が対応|が担当)(?=\s|$|。|、)/u)?.[1] ??
    t.match(/担当(?:者)?(?:は|:)?\s?([\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}ー]{1,8}?)(?:さん)?(?=\s|$|。|、)/u)?.[1] ??
    null;
  // 来る人: 「佐藤様」「佐藤さま」(会社の人に「様」は付けない前提)
  const nameMatch = t.match(/([\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}ー]{1,10}?)\s?(?:様|さま)(?=\s|$|。|、|ご?来|が|と|\d)/u);
  // 「ABC工業の鈴木様」は「の」の後ろがお名前、前は会社名
  const rawName = nameMatch?.[1] ?? "";
  const visitorName = rawName.includes("の") ? rawName.slice(rawName.lastIndexOf("の") + 1) : rawName;
  const nameLead = rawName.includes("の") ? rawName.slice(0, rawName.lastIndexOf("の")) : "";
  const member = (hostWord ? matchMember(ctx.users, hostWord) : null) ?? findMember(ctx.users, t.replace(nameMatch?.[0] ?? "\u0000", " "), visitorName || null);
  const party = findParty(ctx.parties, t, null);
  // 会社名: 住所録にあればその名前。なければ「◯◯様」の直前のことば
  let visitorCompany = party?.name ?? null;
  if (!visitorCompany && nameMatch && nameMatch.index !== undefined) {
    const before = t.slice(0, nameMatch.index).trim().split(" ").pop() ?? "";
    const tail = nameMatch.index > 0 && t[nameMatch.index - 1] !== " " ? before : "";
    const word = (nameLead ? `${tail}${nameLead}` : before).replace(/の$/, "");
    if (word.length >= 2 && !DATE_WORD.test(word) && !/\d|曜|今日|本日|明日|あした|明後日|あさって|午前|午後/.test(word) && !/(から|まで)$/.test(word)) visitorCompany = word;
  }
  // 用件: 日付・時刻・相手・担当・決まり文句を外した残り
  let rest = nameMatch ? t.replace(nameMatch[0], " ") : t;
  if (visitorCompany) {
    // 住所録の名前と書き方が違っても(「さくら商事」と「株式会社さくら商事」)、会社名の一部なら外す
    const key = normalizeName(visitorCompany);
    rest = rest
      .replace(visitorCompany, " ")
      .split(" ")
      .filter((w) => !(normalizeName(w).length >= 2 && key.includes(normalizeName(w))))
      .join(" ");
  }
  rest = rest
    .replace(/(午前|午後)?\s*\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?)\s*(?:から|〜|~|-)?\s*((午前|午後)?\s*\d{1,2}(?::\d{2}|時(?:半|\d{1,2}分)?)\s*(まで)?)?/g, " ")
    .replace(/\d{1,2}\s*時間(半)?|\d{2,3}\s*分間?/g, " ")
    .replace(/今日|本日|明日|あした|明後日|あさって|(今週|来週|再来週)?の?\s*[月火水木金土日]曜日?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/g, " ")
    .replace(/[\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}ー]{1,8}?\s?(?:さん|部長|課長|係長|主任|社長)?\s?(?:宛て?|あて|へ|に面会|に会い|が対応|が担当)(?=\s|$|。|、)/u, " ")
    .replace(/担当(?:者)?(?:は|:)?\s?[\p{sc=Han}\p{sc=Katakana}\p{sc=Hiragana}ー]{1,8}?(?:さん)?(?=\s|$|。|、)/u, " ")
    .replace(/(?:が|の)?\s*(?:ご?来社|ご?来訪|来客|お見え|いらっしゃる|来られる|来ます|来る)(?:予定|の予定)?(?:です|あり)?/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s、。,:のでにがと]+|[\s、。,:のでにがと]+$/g, "")
    .trim();
  return { date, time, visitorName, visitorCompany: clean(visitorCompany, 60), partyKind: party?.kind ?? null, partyId: party?.id ?? null, hostUserId: member?.id ?? null, purpose: rest.slice(0, 100) };
}

export async function parseVisitor(companyId: string, text: string) {
  const t = String(text ?? "").trim().slice(0, 300);
  if (!t) throw new UserError("来客の予定を書いてください(例: 明日14時 さくら商事 佐藤様 山田さん宛 打ち合わせ)");
  const ctx = await memoContext(companyId);
  return templateVisitor(t, ctx, jstDateKey(new Date()));
}

export async function createVisitor(user: { id: string; companyId: string; name: string }, raw: Record<string, unknown>) {
  const ctx = await memoContext(user.companyId);
  const date = String(raw.date ?? "");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("日付を正しく入れてください");
  const time = raw.time ? String(raw.time) : null;
  if (time && !validHM(time)) throw new UserError("時刻を正しく入れてください(例: 14:00)");
  const visitorName = clean(raw.visitorName, 40);
  const partyKind = raw.partyKind === "customer" || raw.partyKind === "vendor" ? raw.partyKind : null;
  const party = partyKind && typeof raw.partyId === "string" ? ctx.parties.find((p) => p.kind === partyKind && p.id === raw.partyId) : null;
  const visitorCompany = clean(raw.visitorCompany, 60) ?? party?.name ?? null;
  if (!visitorName && !visitorCompany) throw new UserError("来る人のお名前か会社名を入れてください");
  const hostUserId = typeof raw.hostUserId === "string" && raw.hostUserId ? raw.hostUserId : null;
  const host = hostUserId ? ctx.users.find((u) => u.id === hostUserId) : null;
  if (hostUserId && !host) throw new UserError("担当の人が見つかりません");
  return prisma.visitor.create({
    data: { companyId: user.companyId, date, time, visitorName: visitorName ?? "ご担当者", visitorCompany, partyKind: party?.kind ?? null, partyId: party?.id ?? null, hostUserId: host?.id ?? null, hostName: host?.name ?? null, purpose: clean(raw.purpose, 100), createdByName: user.name },
  });
}

export const visitorLabel = (v: { visitorName: string; visitorCompany: string | null }) => `${v.visitorCompany ? `${v.visitorCompany} ` : ""}${v.visitorName}様`;

// 同じ日の会議室の予約で、相手の会社名か名前が用件に入っているもの
async function roomsFor(companyId: string, rows: { date: string; visitorName: string; visitorCompany: string | null }[]) {
  const dates = [...new Set(rows.map((r) => r.date))];
  if (!dates.length) return new Map<string, { facility: string; start: string; end: string }>();
  const bookings = await prisma.booking.findMany({ where: { companyId, date: { in: dates }, facility: { active: true } }, include: { facility: { select: { name: true } } }, orderBy: { start: "asc" } });
  const out = new Map<string, { facility: string; start: string; end: string }>();
  for (const r of rows) {
    const keys = [r.visitorCompany, r.visitorName !== "ご担当者" ? r.visitorName : null].filter((k): k is string => !!k && normalizeName(k).length >= 2).map(normalizeName);
    const b = bookings.find((x) => x.date === r.date && keys.some((k) => normalizeName(x.title).includes(k)));
    if (b) out.set(`${r.date}|${r.visitorCompany ?? ""}|${r.visitorName}`, { facility: b.facility.name, start: b.start, end: b.end });
  }
  return out;
}

// 今日と先7日の予定、今日までの30日のお帰りになった記録
export async function listVisitors(companyId: string) {
  const today = jstDateKey(new Date());
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = await prisma.visitor.findMany({ where: { companyId, date: { gte: from, lte: to }, status: { not: "CANCELLED" } }, orderBy: [{ date: "asc" }, { time: "asc" }, { createdAt: "asc" }], take: 500 });
  const rooms = await roomsFor(
    companyId,
    rows.filter((r) => r.date >= today),
  );
  return rows.map((r) => ({ ...r, room: rooms.get(`${r.date}|${r.visitorCompany ?? ""}|${r.visitorName}`) ?? null }));
}

// お見えになった・お帰りになった・取り消し。お見えになったら担当の人にメールで知らせる
export async function updateVisitor(user: { id: string; companyId: string; name: string }, id: string, raw: Record<string, unknown>, request?: Request) {
  const v = await prisma.visitor.findFirst({ where: { id, companyId: user.companyId } });
  if (!v) throw new UserError("見つかりません");
  if (raw.status === "ARRIVED") {
    const updated = await prisma.visitor.update({ where: { id }, data: { status: "ARRIVED", arrivedAt: new Date(), leftAt: null } });
    let notified = false;
    if (raw.notify !== false && v.hostUserId && v.hostUserId !== user.id) {
      const host = await prisma.user.findFirst({ where: { id: v.hostUserId, companyId: user.companyId, active: true }, select: { email: true, name: true } });
      const room = (await roomsFor(user.companyId, [v])).get(`${v.date}|${v.visitorCompany ?? ""}|${v.visitorName}`);
      if (host?.email) {
        try {
          await sendMail({
            companyId: user.companyId,
            kind: "NOTICE",
            to: host.email,
            subject: `【来客】${visitorLabel(v)}がお見えになりました`,
            text: `${host.name}さん\n\n${visitorLabel(v)}がお見えになりました${room ? `(${room.facility} ${room.start}〜${room.end} の予約があります)` : ""}。\n${v.purpose ? `用件: ${v.purpose}\n` : ""}受付: ${user.name}\n\n来客の受付簿: ${appUrl(request)}/visitors\n`,
            sentByName: user.name,
            relatedId: v.id,
          });
          notified = true;
        } catch (error) {
          if (!(error instanceof MailError)) throw error;
        }
      }
    }
    return { visitor: updated, notified };
  }
  if (raw.status === "LEFT") return { visitor: await prisma.visitor.update({ where: { id }, data: { status: "LEFT", leftAt: new Date(), arrivedAt: v.arrivedAt ?? new Date() } }), notified: false };
  if (raw.status === "EXPECTED") return { visitor: await prisma.visitor.update({ where: { id }, data: { status: "EXPECTED", arrivedAt: null, leftAt: null } }), notified: false };
  if (raw.status === "CANCELLED") return { visitor: await prisma.visitor.update({ where: { id }, data: { status: "CANCELLED" } }), notified: false };
  throw new UserError("変更の内容がありません");
}

// やることリスト: 今日まだお見えになっていない来客(user があればその人が担当のものと担当なし)
export async function countVisitorsToday(companyId: string, userId?: string) {
  const today = jstDateKey(new Date());
  return prisma.visitor.count({ where: { companyId, date: today, status: "EXPECTED", ...(userId ? { OR: [{ hostUserId: userId }, { hostUserId: null }] } : {}) } });
}

// AIアシスタント・朝のまとめ用: ある日の来客
export async function visitorsOn(companyId: string, date: string) {
  const rows = await prisma.visitor.findMany({ where: { companyId, date, status: { not: "CANCELLED" } }, orderBy: [{ time: "asc" }, { createdAt: "asc" }] });
  const rooms = await roomsFor(companyId, rows);
  return rows.map((r) => ({ id: r.id, time: r.time, label: visitorLabel(r), host: r.hostName, purpose: r.purpose, status: r.status, room: rooms.get(`${r.date}|${r.visitorCompany ?? ""}|${r.visitorName}`) ?? null }));
}

export const VISITOR_STATUS: Record<string, string> = { EXPECTED: "予定", ARRIVED: "お見えになっている", LEFT: "お帰りになった", CANCELLED: "取り消し" };
