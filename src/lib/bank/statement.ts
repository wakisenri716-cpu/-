import { createHash } from "crypto";
import { parseCsv } from "@/lib/csvParse";

// 銀行ごとに列名が違うので、よくある呼び方をまとめて探す。
// 出金・入金が別の列の銀行と、符号付きの「金額」1列の銀行の両方に対応する。
const ALIASES = {
  date: ["日付", "取引日", "年月日", "取扱日", "取引年月日", "勘定日", "お取引日"],
  description: ["摘要", "取引内容", "お取引内容", "内容", "摘要内容", "お取引先", "取引先", "明細"],
  withdrawal: ["出金", "出金額", "出金金額", "お引出し", "お引出金額", "お支払金額", "支払金額", "引出額", "お引き出し"],
  deposit: ["入金", "入金額", "入金金額", "お預入れ", "お預入金額", "お預り金額", "預入額", "お預け入れ"],
  amount: ["金額", "取引金額", "入出金額"],
  balance: ["残高", "差引残高", "残高金額", "お取引後残高"],
} as const;

type Column = keyof typeof ALIASES;

export type StatementRow = {
  date: Date;
  description: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  fingerprint: string;
};

function toAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.normalize("NFKC").replace(/[¥,\s円]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned.replace(/^▲/, "-"));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseStatementDate(value: string): Date | null {
  const v = value.normalize("NFKC").trim();
  const m =
    v.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/) ??
    v.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/) ??
    v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export function parseBankStatement(text: string): StatementRow[] {
  const table = parseCsv(text);
  // 口座番号などの前置き行がある銀行もあるので、日付と摘要の列がそろう行をヘッダーとみなす
  const headerIndex = table.findIndex((row) => {
    const cells = row.map((c) => c.trim());
    return ALIASES.date.some((a) => cells.includes(a)) && ALIASES.description.some((a) => cells.includes(a));
  });
  if (headerIndex < 0) {
    throw new Error("銀行明細のCSVとして読み取れません。「日付」と「摘要(内容)」の列が必要です。");
  }

  const header = table[headerIndex].map((h) => h.trim());
  const col = {} as Record<Column, number>;
  for (const key of Object.keys(ALIASES) as Column[]) {
    col[key] = header.findIndex((h) => (ALIASES[key] as readonly string[]).includes(h));
  }
  const hasSplit = col.withdrawal >= 0 || col.deposit >= 0;
  if (!hasSplit && col.amount < 0) {
    throw new Error("銀行明細のCSVとして読み取れません。「出金」「入金」(または「金額」)の列が必要です。");
  }

  const seen = new Map<string, number>();
  const rows: StatementRow[] = [];
  table.slice(headerIndex + 1).forEach((row, i) => {
    const cell = (key: Column) => (col[key] >= 0 ? row[col[key]] : undefined);
    const rawDate = cell("date")?.trim() ?? "";
    if (!rawDate) return;
    const date = parseStatementDate(rawDate);
    if (!date) throw new Error(`${headerIndex + i + 2}行目の日付を読み取れません: "${rawDate}"`);

    let withdrawal = 0;
    let deposit = 0;
    if (hasSplit) {
      withdrawal = Math.abs(toAmount(cell("withdrawal")) ?? 0);
      deposit = Math.abs(toAmount(cell("deposit")) ?? 0);
    } else {
      const amount = toAmount(cell("amount")) ?? 0;
      if (amount < 0) withdrawal = -amount;
      else deposit = amount;
    }
    if (withdrawal === 0 && deposit === 0) return;

    const description = (cell("description") ?? "").trim() || "(摘要なし)";
    const balance = toAmount(cell("balance"));
    // 同じ日に同じ内容・同じ金額の取引が複数あっても別の行として扱えるよう、出現回数もキーに含める
    const base = [date.toISOString().slice(0, 10), description, withdrawal, deposit, balance ?? ""].join("|");
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);

    rows.push({
      date,
      description,
      withdrawal,
      deposit,
      balance,
      fingerprint: createHash("sha256").update(`${base}|${occurrence}`).digest("hex"),
    });
  });
  return rows;
}
