import type { NormalizedPosSale } from "./types";
import { parseCsv } from "@/lib/csvParse";

// Airレジの「データ連携API」はAirレジが承認した連携先システムにしか仕様が
// 公開されていないため、バックオフィスから出力できる「会計明細CSV」を取り込む。
// 会計明細CSVは出力項目・並び順をユーザーが変えられるので、列は位置ではなく
// ヘッダー名で探す。1会計に複数商品があると同じ取引Noの行が複数並ぶ。

const COLUMN_ALIASES = {
  id: ["取引No", "取引NO", "取引番号", "伝票番号"],
  dateTime: ["会計日時"],
  date: ["会計日", "売上日"],
  time: ["会計時間", "会計時刻"],
  total: ["合計", "合計金額", "売上合計"],
  innerTax: ["内消費税"],
  outerTax: ["外消費税"],
  tax: ["消費税", "消費税額"],
  cash: ["現金"],
  store: ["店舗名"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;

function toAmount(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.replace(/[¥￥,\s円]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseJstDateTime(date: string, time: string | undefined): Date | null {
  const d = date.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!d) return null;
  const t = time?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hh = t?.[1] ?? d[4] ?? "0";
  const mm = t?.[2] ?? d[5] ?? "0";
  const ss = t?.[3] ?? d[6] ?? "0";
  const pad = (v: string) => v.padStart(2, "0");
  const result = new Date(`${d[1]}-${pad(d[2])}-${pad(d[3])}T${pad(hh)}:${pad(mm)}:${pad(ss)}+09:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function parseAirregiCsv(text: string): { sales: NormalizedPosSale[]; rowCount: number } {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("CSVが空です");

  const normalizedHeader = header.map((h) => h.trim());
  const index = {} as Record<ColumnKey, number>;
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    index[key] = normalizedHeader.findIndex((h) => (COLUMN_ALIASES[key] as readonly string[]).includes(h));
  }

  const missing: string[] = [];
  if (index.id < 0) missing.push("取引No");
  if (index.dateTime < 0 && index.date < 0) missing.push("会計日");
  if (index.total < 0) missing.push("合計");
  if (missing.length > 0) {
    throw new Error(
      `Airレジの会計明細CSVとして読み取れません。必要な列(${missing.join("・")})が見つかりません。` +
        `バックオフィスの「会計明細CSVファイルの設定」で出力をオンにしてください。`,
    );
  }

  const cell = (row: string[], key: ColumnKey) => (index[key] >= 0 ? row[index[key]] : undefined);
  const hasSplitTax = index.innerTax >= 0 || index.outerTax >= 0;
  const byId = new Map<string, NormalizedPosSale>();

  rows.forEach((row, i) => {
    const externalId = cell(row, "id")?.trim();
    if (!externalId || byId.has(externalId)) return;

    const soldAt =
      index.dateTime >= 0
        ? parseJstDateTime(cell(row, "dateTime") ?? "", undefined)
        : parseJstDateTime(cell(row, "date") ?? "", cell(row, "time"));
    if (!soldAt) throw new Error(`${i + 2}行目の会計日を読み取れません: "${cell(row, "dateTime") ?? cell(row, "date")}"`);

    const total = toAmount(cell(row, "total"));
    const tax = hasSplitTax
      ? toAmount(cell(row, "innerTax")) + toAmount(cell(row, "outerTax"))
      : toAmount(cell(row, "tax"));
    const cashColumn = toAmount(cell(row, "cash"));
    const cash = total >= 0 ? Math.min(Math.max(cashColumn, 0), total) : total;

    byId.set(externalId, {
      externalId,
      soldAt,
      storeName: cell(row, "store")?.trim() || null,
      totalAmount: total,
      taxAmount: tax,
      cashAmount: cash,
      cashlessAmount: total - cash,
    });
  });

  return { sales: [...byId.values()], rowCount: rows.length };
}
