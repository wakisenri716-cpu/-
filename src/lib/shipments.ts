import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureAccount } from "@/lib/accounting/accounts";
import { createManualJournal } from "@/lib/accounting/journal";

// 郵便・宅配の発送記録: 「さくら商事へ請求書 レターパックライト 追跡 1234-5678-9012」のように1行で記録する。
// 決まった料金の方法(レターパックなど)は送料を入れておき、追跡番号があれば追跡のページへのリンクを出す。
// 現金で払った送料は、月ごとにまとめて通信費で仕訳する(切手・レターパックを前に買ってあるときと、月払いの請求は仕訳しない)。

export const METHODS = {
  LETTER: { label: "普通郵便", carrier: "JP", price: null },
  LETTERPACK_LIGHT: { label: "レターパックライト", carrier: "JP", price: 430 },
  LETTERPACK_PLUS: { label: "レターパックプラス", carrier: "JP", price: 600 },
  SMART_LETTER: { label: "スマートレター", carrier: "JP", price: 210 },
  YUPACKET: { label: "ゆうパケット", carrier: "JP", price: null },
  YUPACK: { label: "ゆうパック", carrier: "JP", price: null },
  REGISTERED: { label: "書留", carrier: "JP", price: null },
  EXPRESS: { label: "速達", carrier: "JP", price: null },
  TAKKYUBIN: { label: "宅急便", carrier: "YAMATO", price: null },
  NEKOPOS: { label: "ネコポス", carrier: "YAMATO", price: null },
  HIKYAKU: { label: "飛脚宅配便", carrier: "SAGAWA", price: null },
  OTHER: { label: "そのほか", carrier: null, price: null },
} as const;
export type Method = keyof typeof METHODS;
export const PAID = { CASH: "現金で払った", STAMP: "買ってある切手・レターパック", INVOICE: "月払いの請求" } as const;
export type Paid = keyof typeof PAID;
const CARRIERS = { JP: "日本郵便", YAMATO: "ヤマト運輸", SAGAWA: "佐川急便" } as const;

export function methodOf(text: string): Method {
  const t = text.normalize("NFKC");
  if (/レターパック\s?ライト|LPライト/.test(t)) return "LETTERPACK_LIGHT";
  if (/レターパック\s?プラス|LPプラス|レターパック/.test(t)) return "LETTERPACK_PLUS";
  if (/スマートレター/.test(t)) return "SMART_LETTER";
  if (/ゆうパケット/.test(t)) return "YUPACKET";
  if (/ゆうパック/.test(t)) return "YUPACK";
  if (/書留/.test(t)) return "REGISTERED";
  if (/速達/.test(t)) return "EXPRESS";
  if (/ネコポス/.test(t)) return "NEKOPOS";
  if (/宅急便|ヤマト|クロネコ/.test(t)) return "TAKKYUBIN";
  if (/飛脚|佐川/.test(t)) return "HIKYAKU";
  if (/普通郵便|定形|定型|封書|はがき|ハガキ|郵送|切手/.test(t)) return "LETTER";
  return "OTHER";
}

// 追跡のページ(公式のページの番号を入れるだけ)
export function trackingUrl(carrier: string | null, tracking: string | null) {
  if (!tracking) return null;
  const n = tracking.replace(/[^0-9A-Za-z]/g, "");
  if (carrier === "JP") return `https://trackings.post.japanpost.jp/services/srv/search/direct?searchKind=S002&locale=ja&reqCodeNo1=${n}`;
  if (carrier === "YAMATO") return `https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number00=1&number01=${n}`;
  if (carrier === "SAGAWA") return `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${n}`;
  return null;
}

export function templateShipment(line: string, today: string) {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const method = methodOf(t);
  const m = METHODS[method];
  const trackM = t.match(/(?:追跡番号|追跡|お問い合わせ番号|問合せ番号|伝票番号|伝票|No\.?)\s*[:：]?\s*([0-9][0-9-]{8,18}[0-9])/) ?? t.match(/(?<![\d-])(\d{4}-\d{4}-\d{4}|\d{11,12})(?![\d-])/);
  const tracking = trackM?.[1] ?? null;
  const costM = t.replace(trackM?.[0] ?? "\u0000", " ").match(/(\d[\d,]*)\s*円/);
  const cost = costM ? Number(costM[1].replace(/,/g, "")) : (m.price ?? 0);
  const paidBy: Paid = /切手で|切手を使|買ってある|手持ち/.test(t) ? "STAMP" : /着払い|月払い|請求で|後払い|契約(払い|運賃)/.test(t) ? "INVOICE" : "CASH";
  const recM = t.match(/^(.{1,30}?)(?:様|さま|御中)?\s?(?:へ|に|宛て?|あて)(?=\s|[^\s])/) ?? t.match(/^(.{1,30}?)(?:様|さま|御中)(?=\s|$)/);
  const recipient = recM?.[1]?.trim() ?? "";
  let rest = t;
  for (const s of [trackM?.[0], costM?.[0], recM?.[0]]) if (s) rest = rest.replace(s, " ");
  const contents =
    rest
      .replace(/(様|さま|御中)?\s?(へ|に|宛て?|あて)(?=\s)/, " ")
      .replace(/レターパック\s?(ライト|プラス)?|スマートレター|ゆうパケット|ゆうパック|簡易書留|一般書留|現金書留|書留|速達|普通郵便|定形外?|定型外?|ネコポス|宅急便|ヤマト|クロネコ|飛脚宅配便|飛脚|佐川|で送った|を送った|送った|発送した|発送|郵送|切手で|切手を使った|着払い|月払い|追跡|伝票番号?/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s、。をでのに]+|[\s、。をでのに]+$/g, "")
      .trim()
      .slice(0, 60) || null;
  return { date: today, recipient: recipient.slice(0, 40), contents, method, carrier: m.carrier, tracking, cost, paidBy };
}

export async function parseShipment(text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("送ったものを書いてください(例: さくら商事へ請求書 レターパックライト 追跡 1234-5678-9012)");
  return templateShipment(t, jstDateKey(new Date()));
}

const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";

export async function saveShipment(me: { companyId: string; name: string; role: string }, raw: Record<string, unknown>) {
  if (!canManage(me.role)) throw new UserError("発送の記録は管理者・経理担当がつけます");
  const recipient = String(raw.recipient ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!recipient) throw new UserError("送った相手を入れてください");
  const date = String(raw.date ?? "") || jstDateKey(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > jstDateKey(new Date())) throw new UserError("送った日を正しく入れてください");
  const method: Method = typeof raw.method === "string" && raw.method in METHODS ? (raw.method as Method) : "OTHER";
  const cost = Number(String(raw.cost ?? "0").replace(/[,円\s]/g, ""));
  if (!Number.isInteger(cost) || cost < 0 || cost > 1_000_000) throw new UserError("送料を正しく入れてください");
  const paidBy: Paid = raw.paidBy === "STAMP" || raw.paidBy === "INVOICE" ? raw.paidBy : "CASH";
  return prisma.shipment.create({
    data: { companyId: me.companyId, date, recipient, contents: String(raw.contents ?? "").trim().slice(0, 60) || null, method, carrier: METHODS[method].carrier, tracking: String(raw.tracking ?? "").replace(/\s/g, "").slice(0, 30) || null, cost, paidBy, byName: me.name },
  });
}

export async function deleteShipment(me: { companyId: string; role: string }, id: string) {
  if (!canManage(me.role)) throw new UserError("発送の記録は管理者・経理担当がつけます");
  const row = await prisma.shipment.findFirst({ where: { id, companyId: me.companyId } });
  if (!row) throw new UserError("見つかりません");
  if (row.journalEntryId) throw new UserError("送料はもう仕訳しました。消すときは先に仕訳帳で取り消してください");
  await prisma.shipment.delete({ where: { id } });
}

export async function listShipments(companyId: string, month: string, q?: string) {
  const where = { companyId, ...(q ? { OR: [{ recipient: { contains: q } }, { contents: { contains: q } }, { tracking: { contains: q.replace(/[^0-9A-Za-z]/g, "") || q } }] } : { date: { startsWith: month } }) };
  const rows = await prisma.shipment.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 300 });
  const items = rows.map((r) => ({ ...r, methodLabel: METHODS[r.method as Method]?.label ?? r.method, carrierLabel: r.carrier ? CARRIERS[r.carrier as keyof typeof CARRIERS] : null, trackingUrl: trackingUrl(r.carrier, r.tracking) }));
  const cash = items.filter((r) => r.paidBy === "CASH" && r.date.startsWith(month));
  return { month, items, total: items.filter((r) => r.date.startsWith(month)).reduce((s, r) => s + r.cost, 0), cashUnposted: cash.filter((r) => !r.journalEntryId && r.cost > 0).reduce((s, r) => s + r.cost, 0), cashUnpostedCount: cash.filter((r) => !r.journalEntryId && r.cost > 0).length };
}

// 月の現金の送料を、1つの仕訳(通信費/現金)にまとめる。日付はその月の末日(今月なら今日)
export async function postShipments(me: { companyId: string; role: string }, raw: Record<string, unknown>) {
  if (!canManage(me.role)) throw new UserError("仕訳は管理者・経理担当がします");
  const month = String(raw.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError("月を正しく選んでください");
  const rows = await prisma.shipment.findMany({ where: { companyId: me.companyId, date: { startsWith: month }, paidBy: "CASH", journalEntryId: null, cost: { gt: 0 } } });
  if (!rows.length) throw new UserError("仕訳する送料がありません(現金で払った送料で、まだ仕訳していないものだけです)");
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const today = jstDateKey(new Date());
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const date = end > today ? today : end;
  const [expense, cash] = await prisma.$transaction(async (tx) => [await ensureAccount(tx, me.companyId, "5040"), await ensureAccount(tx, me.companyId, "1010")]);
  const entry = await createManualJournal(me.companyId, {
    date: new Date(`${date}T00:00:00Z`),
    description: `${y}年${m}月の郵便・宅配の送料(現金払い ${rows.length}件)`,
    lines: [
      { accountId: expense.id, debit: total, credit: 0 },
      { accountId: cash.id, debit: 0, credit: total },
    ],
  });
  await prisma.shipment.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { journalEntryId: entry.id } });
  return { count: rows.length, total, entryId: entry.id };
}
