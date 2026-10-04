import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 償却資産申告(固定資産税)の作成補助。毎年1月1日(賦課期日)に持っている事業用の資産を、1月31日までに市区町村へ申告する。
// 評価額は「前年中に取得: 取得価額 × (1 − r/2)、その後は毎年 × (1 − r)」(r は耐用年数に応じた減価率)で、取得価額の5%が下限。
// 課税標準額の合計が150万円未満なら課税されない(免税点)。税額の目安は 課税標準額(千円未満切捨て)× 1.4%。

export const ASSET_TYPES = [
  { key: "1", label: "構築物", hint: "看板・塀・舗装・内装工事など" },
  { key: "2", label: "機械及び装置", hint: "工作機械・印刷機など" },
  { key: "3", label: "船舶", hint: "" },
  { key: "4", label: "航空機", hint: "" },
  { key: "5", label: "車両及び運搬具", hint: "フォークリフトなど(自動車税・軽自動車税の車は対象外)" },
  { key: "6", label: "工具・器具及び備品", hint: "パソコン・机・応接セット・エアコンなど" },
] as const;
export const EXCLUDED = "EXCLUDED";
const TYPE_KEYS: string[] = ASSET_TYPES.map((t) => t.key);

// 償却資産として扱わない少額の資産(10万円未満)
export const SMALL_ASSET = 100_000;
export const EXEMPTION = 1_500_000;
export const TAX_RATE = 0.014;

// 耐用年数に応じた減価率(固定資産評価基準の減価率表: 1 − 0.1^(1/耐用年数) を小数3位に丸めたもの)
export function reductionRate(life: number) {
  const n = Math.max(2, Math.min(50, Math.floor(life)));
  return Math.round((1 - Math.pow(0.1, 1 / n)) * 1000) / 1000;
}

// year 年1月1日の評価額
export function evaluate(cost: number, life: number, acquiredYear: number, year: number) {
  const r = reductionRate(life);
  let v = Math.floor(cost * (1 - r / 2));
  for (let y = acquiredYear + 1; y < year; y++) v = Math.floor(v * (1 - r));
  return Math.max(v, Math.floor(cost * 0.05));
}

export function defaultYear(now = new Date()) {
  const [y, m] = jstDateKey(now).split("-").map(Number);
  // 10月からは翌年1月の申告の準備
  return m >= 10 ? y + 1 : y;
}

export function parseYear(value: unknown, now = new Date()) {
  if (value === undefined || value === null || value === "") return defaultYear(now);
  const y = Number(value);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new UserError("年を正しく指定してください");
  return y;
}

type Status = "taxable" | "excluded" | "small" | "notYet" | "disposed";

export async function getPropertyTaxReport(companyId: string, yearValue: unknown) {
  const year = parseYear(yearValue);
  const jan1 = `${year}-01-01`;
  const prevJan1 = `${year - 1}-01-01`;
  const assets = await prisma.fixedAsset.findMany({ where: { companyId }, orderBy: { acquisitionDate: "asc" } });
  const rows = assets.map((a) => {
    const acquired = jstDateKey(a.acquisitionDate);
    const disposed = a.disposedAt ? jstDateKey(a.disposedAt) : null;
    const type = a.taxAssetType && (TYPE_KEYS.includes(a.taxAssetType) || a.taxAssetType === EXCLUDED) ? a.taxAssetType : null;
    let status: Status = "taxable";
    if (acquired >= jan1) status = "notYet";
    else if (disposed && disposed < prevJan1) status = "disposed";
    else if (type === EXCLUDED) status = "excluded";
    else if (a.acquisitionCost < SMALL_ASSET) status = "small";
    // 前年中に売却・除却した資産は「減少」として申告する(評価額はなし)
    const decreased = status === "taxable" && !!disposed && disposed < jan1;
    const acquiredYear = Number(acquired.slice(0, 4));
    const held = status === "taxable" && !decreased;
    return {
      id: a.id,
      name: a.name,
      acquired,
      disposed,
      cost: a.acquisitionCost,
      life: a.usefulLifeYears,
      type,
      status,
      // 前年中に取得(増加)・前年中に減少
      increased: held && acquired >= prevJan1,
      decreased,
      rate: reductionRate(a.usefulLifeYears),
      value: held ? evaluate(a.acquisitionCost, a.usefulLifeYears, acquiredYear, year) : 0,
    };
  });
  const relevant = rows.filter((r) => r.status === "taxable");
  // 種類ごとの取得価額(前年前取得・前年中減少・前年中取得・計)と評価額。未分類は工具器具備品として仮に数える
  const byType = ASSET_TYPES.map((t) => {
    const list = relevant.filter((r) => (r.type ?? "6") === t.key);
    const before = list.filter((r) => r.acquired < prevJan1).reduce((s, r) => s + r.cost, 0);
    const decrease = list.filter((r) => r.decreased).reduce((s, r) => s + r.cost, 0);
    const increase = list.filter((r) => r.increased).reduce((s, r) => s + r.cost, 0);
    return { key: t.key, label: t.label, before, decrease, increase, total: before - decrease + increase, value: list.reduce((s, r) => s + r.value, 0), count: list.filter((r) => !r.decreased).length };
  });
  const base = byType.reduce((s, t) => s + t.value, 0);
  const exempt = base < EXEMPTION;
  return {
    year,
    reiwa: year - 2018,
    rows,
    byType,
    summary: {
      base,
      exempt,
      // 税額の目安: 課税標準額(千円未満切捨て)× 1.4%(百円未満切捨て)
      estimatedTax: exempt ? 0 : Math.floor((Math.floor(base / 1000) * 1000 * TAX_RATE) / 100) * 100,
      unclassified: relevant.filter((r) => !r.type).length,
      count: relevant.filter((r) => !r.decreased).length,
    },
  };
}

export async function setTaxAssetType(companyId: string, id: string, value: unknown) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new UserError("固定資産が見つかりません");
  const v = String(value ?? "");
  if (v && !TYPE_KEYS.includes(v) && v !== EXCLUDED) throw new UserError("資産の種類を選んでください");
  return prisma.fixedAsset.update({ where: { id }, data: { taxAssetType: v || null } });
}

// やることリスト用: 12月・1月に、申告する資産があれば知らせる(申告期限は1月31日)
export async function propertyTaxReminder(companyId: string, now = new Date()) {
  const m = Number(jstDateKey(now).slice(5, 7));
  if (m !== 12 && m !== 1) return { year: defaultYear(now), count: 0 };
  const year = m === 12 ? Number(jstDateKey(now).slice(0, 4)) + 1 : Number(jstDateKey(now).slice(0, 4));
  const report = await getPropertyTaxReport(companyId, year);
  return { year, count: report.summary.count > 0 ? 1 : 0 };
}
