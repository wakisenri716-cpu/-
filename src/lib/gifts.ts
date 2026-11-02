import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { findParty, memoContext } from "@/lib/phoneMemos";
import { relativeDue } from "@/lib/teamTasks";

// 贈答品の記録: お歳暮・お中元などの「送ったもの」「いただいたもの」を1行で記録する。
// いただいたものにお礼をしていなければ知らせ(お礼状の下書きへつなぐ)、去年送った相手のうち今年まだの相手、
// いただいたのにこちらから送っていない相手を並べる。

export const SEASONS = { OSEIBO: "お歳暮", OCHUGEN: "お中元", OTHER: "そのほか" } as const;
export type Season = keyof typeof SEASONS;
export const DIRECTIONS = { SENT: "送った", RECEIVED: "いただいた" } as const;
export type Direction = keyof typeof DIRECTIONS;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max) || null;

// 季節: 言葉があればそれ、なければ月で(11・12月はお歳暮、6〜8月はお中元)
export function seasonOf(text: string, date: string): Season {
  if (/歳暮/.test(text)) return "OSEIBO";
  if (/中元/.test(text)) return "OCHUGEN";
  const m = Number(date.slice(5, 7));
  return m >= 11 ? "OSEIBO" : m >= 6 && m <= 8 ? "OCHUGEN" : "OTHER";
}

export type GiftDraft = { direction: Direction; season: Season; date: string; partyKind: "customer" | "vendor" | null; partyId: string | null; partyName: string; item: string | null; amount: number | null };

// 1行を分ける(何も保存しない)。「さくら商事からお歳暮 洋菓子」はいただいた、「さくら商事へお歳暮 ハム 5,400円」は送った
export function templateGift(line: string, ctx: Awaited<ReturnType<typeof memoContext>>, today: string): GiftDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const received = /(から|より)(?!\s*送)|いただ|頂い|頂戴|届いた|もらった|受け取/.test(t) && !/(へ|に)(お歳暮|お中元|贈|送)/.test(t);
  const direction: Direction = received ? "RECEIVED" : "SENT";
  const date = relativeDue(t.replace(/\d[\d,]*\s*円/g, " "), today) ?? today;
  const amountM = t.match(/(\d[\d,]*)\s*円/);
  const amount = amountM ? Number(amountM[1].replace(/,/g, "")) : null;
  const party = findParty(ctx.parties, t, null);
  const word = t.match(/^([^\s、。]{2,25}?)\s?(?:様|さま|さん)?\s?(?:から|より|へ|に|宛)/)?.[1] ?? null;
  const partyName = party?.name ?? word ?? "";
  // 品物: 相手・季節のことば・金額・日付を外した残り
  let rest = t;
  for (const s of [word, party?.name]) if (s) rest = rest.replace(s, " ");
  rest = rest
    .replace(/\d[\d,]*\s*円/g, " ")
    .replace(/(様|さま|さん)?\s?(から|より|へ|に|宛)\s?/, " ")
    .replace(/お?御?(歳暮|中元)(を|が)?|贈答品?/g, " ")
    .replace(/今日|本日|昨日|きのう|一昨日|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/g, " ")
    .replace(/(を|が)?\s*(いただ(いた|きました)|頂(いた|戴)|届いた|もらった|受け取った|送った|送る|贈った|贈る|手配(した|済み)?)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s、。,:のをが]+|[\s、。,:のをが]+$/g, "")
    .trim();
  return { direction, season: seasonOf(t, date), date, partyKind: party?.kind ?? null, partyId: party?.id ?? null, partyName, item: rest.slice(0, 60) || null, amount: amount && amount > 0 && amount <= 10_000_000 ? amount : null };
}

export async function parseGift(companyId: string, text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("贈答品のことを書いてください(例: さくら商事からお歳暮 洋菓子の詰め合わせ)");
  return templateGift(t, await memoContext(companyId), jstDateKey(new Date()));
}

export async function createGift(user: { companyId: string; name: string }, raw: Record<string, unknown>) {
  const direction: Direction = raw.direction === "RECEIVED" ? "RECEIVED" : "SENT";
  const date = String(raw.date ?? "") || jstDateKey(new Date());
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new UserError("日付を正しく入れてください");
  const ctx = await memoContext(user.companyId);
  const partyKind = raw.partyKind === "customer" || raw.partyKind === "vendor" ? raw.partyKind : null;
  const party = partyKind && typeof raw.partyId === "string" ? ctx.parties.find((p) => p.kind === partyKind && p.id === raw.partyId) : null;
  const partyName = clean(raw.partyName, 60) ?? party?.name ?? null;
  if (!partyName) throw new UserError("相手を入れてください");
  const amountRaw = String(raw.amount ?? "").replace(/[,円\s]/g, "");
  if (amountRaw && !/^\d{1,8}$/.test(amountRaw)) throw new UserError("金額を正しく入れてください");
  const season: Season = raw.season === "OSEIBO" || raw.season === "OCHUGEN" || raw.season === "OTHER" ? raw.season : seasonOf("", date);
  return prisma.giftRecord.create({
    data: { companyId: user.companyId, direction, season, year: Number(date.slice(0, 4)), date, partyKind: party?.kind ?? null, partyId: party?.id ?? null, partyName, item: clean(raw.item, 60), amount: amountRaw ? Number(amountRaw) : null, note: clean(raw.note, 200), createdByName: user.name },
  });
}

export async function updateGift(companyId: string, id: string, raw: Record<string, unknown>) {
  const g = await prisma.giftRecord.findFirst({ where: { id, companyId } });
  if (!g) throw new UserError("見つかりません");
  if (raw.action === "thanked") return prisma.giftRecord.update({ where: { id }, data: { thankedAt: raw.thanked === false ? null : new Date() } });
  if (raw.action === "delete") {
    await prisma.giftRecord.delete({ where: { id } });
    return null;
  }
  throw new UserError("変更の内容がありません");
}

const sameParty = (a: { partyKind: string | null; partyId: string | null; partyName: string }, b: { partyKind: string | null; partyId: string | null; partyName: string }) =>
  a.partyId && b.partyId ? a.partyKind === b.partyKind && a.partyId === b.partyId : a.partyName.replace(/\s/g, "") === b.partyName.replace(/\s/g, "");

// 画面: その年の記録と、季節ごとの「去年送ったのに今年まだ」「いただいたのに送っていない」
export async function listGifts(companyId: string, year: number) {
  const rows = await prisma.giftRecord.findMany({ where: { companyId, year: { in: [year, year - 1] } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  const thisYear = rows.filter((r) => r.year === year);
  const lastYear = rows.filter((r) => r.year === year - 1);
  const seasons = (["OSEIBO", "OCHUGEN"] as const).map((season) => {
    const sentNow = thisYear.filter((r) => r.season === season && r.direction === "SENT");
    const receivedNow = thisYear.filter((r) => r.season === season && r.direction === "RECEIVED");
    const sentLast = lastYear.filter((r) => r.season === season && r.direction === "SENT");
    const seen = new Set<string>();
    const notYet = sentLast
      .filter((r) => !sentNow.some((s) => sameParty(s, r)))
      .filter((r) => {
        const k = r.partyId ?? r.partyName;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((r) => ({ partyKind: r.partyKind, partyId: r.partyId, partyName: r.partyName, item: r.item, amount: r.amount }));
    const notReturned = receivedNow.filter((r) => !sentNow.some((s) => sameParty(s, r))).map((r) => ({ partyKind: r.partyKind, partyId: r.partyId, partyName: r.partyName, item: r.item }));
    return { season, label: SEASONS[season], sentTotal: sentNow.reduce((s, r) => s + (r.amount ?? 0), 0), sentCount: sentNow.length, receivedCount: receivedNow.length, notYet, notReturned };
  });
  return { year, records: thisYear, seasons };
}

// やることリスト: いただいたのにお礼をしていないもの(この60日)
export async function countUnthanked(companyId: string) {
  const since = new Date(Date.parse(`${jstDateKey(new Date())}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
  return prisma.giftRecord.count({ where: { companyId, direction: "RECEIVED", thankedAt: null, date: { gte: since } } });
}
