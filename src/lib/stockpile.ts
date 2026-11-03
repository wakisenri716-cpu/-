import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { parseDateText } from "@/lib/staffLicenses";

// 防災の備蓄品: 「保存水 2L 24本 2030/3まで 倉庫」のように1行で記録し、賞味期限・使用期限が近いもの(90日)を知らせる。
// 社員の人数から、3日分(水は1人1日3リットル・食料は1日3食・簡易トイレは1日5回)が足りるかを見る。

export const CATEGORIES = { WATER: "水", FOOD: "食料", TOILET: "簡易トイレ", MEDICAL: "救急・衛生", OTHER: "そのほか" } as const;
export type Category = keyof typeof CATEGORIES;
export const DAYS = 3;
// 1人1日あたりの目安(東京都の帰宅困難者対策のめやす)
export const PER_DAY: Partial<Record<Category, { amount: number; unit: string }>> = { WATER: { amount: 3, unit: "リットル" }, FOOD: { amount: 3, unit: "食" }, TOILET: { amount: 5, unit: "回" } };
export const SOON_DAYS = 90;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

export function categoryOf(text: string): Category {
  if (/水(?!筒)|ウォーター|飲料/.test(text)) return "WATER";
  if (/トイレ|便袋|排便/.test(text)) return "TOILET";
  if (/米|ご飯|ごはん|パン|缶詰|乾パン|カンパン|クラッカー|ビスケット|食|おかゆ|レトルト|羊羹|ようかん|ゼリー|カロリー/.test(text)) return "FOOD";
  if (/救急|絆創膏|包帯|消毒|マスク|ガーゼ|常備薬|体温計|生理用品|ウェット|ティッシュ/.test(text)) return "MEDICAL";
  return "OTHER";
}

// 期限: 2030/3/31・令和12年3月・2030年3月・2030/3(日がなければ月末)
export function parseExpiry(text: string): string | null {
  const full = parseDateText(text);
  if (full) return full;
  const t = text.normalize("NFKC");
  let m = t.match(/(\d{4})[/\-.年](\d{1,2})月?(?![\d/\-.])/);
  let y: number | null = null;
  let mo = 0;
  if (m) [y, mo] = [Number(m[1]), Number(m[2])];
  else if ((m = t.match(/(?:令和|R)\s*(\d{1,2}|元)[年.\-/](\d{1,2})月?(?![\d/\-.])/i))) [y, mo] = [2018 + (m[1] === "元" ? 1 : Number(m[1])), Number(m[2])];
  if (!y || mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${pad(mo)}-${pad(last)}`;
}

export type StockDraft = { name: string; category: Category; quantity: number | null; unit: string | null; amountPerUnit: number | null; expiresOn: string | null; place: string | null };

// 1行を分ける(何も保存しない)
export function templateStock(line: string): StockDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const expiresOn = parseExpiry(t);
  // 日付の部分は数・量を読む前に外す
  const noDate = t.replace(/(\d{4})[/\-.年](\d{1,2})([/\-.月](\d{1,2})日?|月)?|(?:令和|R)\s*(\d{1,2}|元)[年.\-/](\d{1,2})([月.\-/](\d{1,2})日?|月)?/gi, " ");
  const category = categoryOf(t);
  // 1つあたりの量: 2L・500ml・2リットル
  const volM = noDate.match(/(\d+(?:\.\d+)?)\s*(L|l|リットル|ℓ|ml|mL|ミリリットル)(?![a-z])/);
  const amountFromVol = volM ? Number(volM[1]) / (/m/i.test(volM[2]) || /ミリ/.test(volM[2]) ? 1000 : 1) : null;
  // 数: 24本・3箱・50食・100回分
  const rest = volM ? noDate.replace(volM[0], " ") : noDate;
  const qtyM = rest.match(/(\d[\d,]*)\s*(本|箱|ケース|袋|個|食|回分|回|枚|セット|缶|パック|人分|台|着|足|巻|組|つ)/);
  const bare = qtyM ? null : rest.match(/(?:^|\s)(\d{1,5})(?=\s|$)/);
  const quantity = qtyM ? Number(qtyM[1].replace(/,/g, "")) : bare ? Number(bare[1]) : null;
  const unit = qtyM?.[2] ?? null;
  // 1箱あたりの量: 「1箱12本」「50食入り」
  const perM = rest.match(/(\d+)\s*(食|回|本)\s*(入り?|分)/);
  let amountPerUnit = category === "WATER" ? amountFromVol : null;
  if (category === "FOOD") amountPerUnit = unit === "食" ? 1 : perM && perM[2] === "食" ? Number(perM[1]) : 1;
  if (category === "TOILET") amountPerUnit = unit === "回分" || unit === "回" ? 1 : perM && perM[2] === "回" ? Number(perM[1]) : 1;
  const place = t.match(/(倉庫|書庫|会議室|事務所|ロッカー|棚|地下|[^\s]{1,10}(室|庫|階))(?:\s|$|に|の)/)?.[1] ?? null;
  let name = rest;
  for (const s of [qtyM?.[0], bare?.[0], perM?.[0], place]) if (s) name = name.replace(s, " ");
  name = name
    .replace(/(まで|までの|賞味期限|消費期限|使用期限|期限|有効)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s、,のをが]+|[\s、,のをが]+$/g, "")
    .trim();
  return { name: name.slice(0, 40) || CATEGORIES[category], category, quantity: quantity && quantity > 0 && quantity <= 1_000_000 ? quantity : null, unit, amountPerUnit, expiresOn, place };
}

export async function parseStock(text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("備蓄品のことを書いてください(例: 保存水 2L 24本 2030/3まで 倉庫)");
  return templateStock(t);
}

const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";

export async function saveStock(user: { companyId: string; name: string; role: string }, raw: Record<string, unknown>, id?: string) {
  if (!canManage(user.role)) throw new UserError("備蓄品は管理者・経理担当が記録します");
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) throw new UserError("品物の名前を入れてください");
  const qty = String(raw.quantity ?? "").replace(/[,\s]/g, "");
  if (!/^\d{1,7}$/.test(qty)) throw new UserError("数を入れてください(0も入れられます)");
  const amountRaw = String(raw.amountPerUnit ?? "").trim();
  const amountPerUnit = amountRaw ? Number(amountRaw) : null;
  if (amountPerUnit !== null && (!Number.isFinite(amountPerUnit) || amountPerUnit <= 0 || amountPerUnit > 10_000)) throw new UserError("1つあたりの量を正しく入れてください");
  const expiresOn = String(raw.expiresOn ?? "").trim() || null;
  if (expiresOn && (!DATE.test(expiresOn) || Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`)) || new Date(`${expiresOn}T00:00:00Z`).toISOString().slice(0, 10) !== expiresOn)) throw new UserError("期限を正しく入れてください");
  const category: Category = typeof raw.category === "string" && raw.category in CATEGORIES ? (raw.category as Category) : categoryOf(name);
  const data = {
    name,
    category,
    quantity: Number(qty),
    unit: String(raw.unit ?? "").trim().slice(0, 10) || null,
    amountPerUnit,
    expiresOn,
    place: String(raw.place ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null,
    note: String(raw.note ?? "").trim().slice(0, 200) || null,
  };
  if (id) {
    const { count } = await prisma.stockpileItem.updateMany({ where: { id, companyId: user.companyId }, data });
    if (!count) throw new UserError("見つかりません");
    return prisma.stockpileItem.findUniqueOrThrow({ where: { id } });
  }
  return prisma.stockpileItem.create({ data: { companyId: user.companyId, ...data, createdByName: user.name } });
}

export async function deleteStock(user: { companyId: string; role: string }, id: string) {
  if (!canManage(user.role)) throw new UserError("備蓄品は管理者・経理担当が記録します");
  const { count } = await prisma.stockpileItem.deleteMany({ where: { id, companyId: user.companyId } });
  if (!count) throw new UserError("見つかりません");
}

const stateOf = (expiresOn: string | null, today: string) => {
  if (!expiresOn) return { state: "OK" as const, days: null };
  const d = daysUntil(expiresOn, today);
  return { state: d < 0 ? ("EXPIRED" as const) : d <= SOON_DAYS ? ("SOON" as const) : ("OK" as const), days: d };
};

// 一覧と、3日分が足りるか(期限の切れたものは数えない)。people を渡さなければ在籍している社員の人数
export async function listStock(companyId: string, peopleOverride?: number) {
  const today = jstDateKey(new Date());
  const [rows, staff] = await Promise.all([prisma.stockpileItem.findMany({ where: { companyId }, orderBy: [{ category: "asc" }, { expiresOn: "asc" }] }), prisma.staff.count({ where: { companyId, active: true } })]);
  const people = peopleOverride && peopleOverride > 0 ? Math.min(peopleOverride, 100_000) : staff;
  const items = rows.map((r) => ({ ...r, ...stateOf(r.expiresOn, today) }));
  const coverage = (Object.keys(PER_DAY) as Category[]).map((c) => {
    const per = PER_DAY[c]!;
    const usable = items.filter((i) => i.category === c && i.state !== "EXPIRED");
    const have = Math.round(usable.reduce((s, i) => s + i.quantity * (i.amountPerUnit ?? (c === "WATER" ? 0 : 1)), 0) * 10) / 10;
    const need = people * per.amount * DAYS;
    // 量のわからない水(1本あたりのリットルが空)
    const unknown = c === "WATER" ? usable.filter((i) => i.amountPerUnit == null).length : 0;
    return { category: c, label: CATEGORIES[c], unit: per.unit, have, need, short: Math.max(0, Math.round((need - have) * 10) / 10), days: people ? Math.floor((have / (people * per.amount)) * 10) / 10 : null, unknown };
  });
  return { today, people, staffCount: staff, items, coverage, alerts: items.filter((i) => i.state !== "OK").length };
}

// やることリスト: 期限が切れた・90日以内に切れる備蓄品
export async function countStockAlerts(companyId: string) {
  const today = jstDateKey(new Date());
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  return prisma.stockpileItem.count({ where: { companyId, quantity: { gt: 0 }, expiresOn: { not: null, lte: until } } });
}
