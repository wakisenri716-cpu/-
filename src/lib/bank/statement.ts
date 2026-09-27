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
    const cardLike = table.some((row) => row.some((c) => /^(ご)?利用(日|年月日)/.test(c.normalize("NFKC").trim())));
    throw new Error(
      cardLike
        ? "カードの利用明細のようです。上の「口座・カード」でカードを選んでから取り込んでください。"
        : "銀行明細のCSVとして読み取れません。「日付」と「摘要(内容)」の列が必要です。",
    );
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
    rows.push(makeRow(seen, date, description, withdrawal, deposit, toAmount(cell("balance"))));
  });
  return rows;
}

function makeRow(seen: Map<string, number>, date: Date, description: string, withdrawal: number, deposit: number, balance: number | null): StatementRow {
  // 同じ日に同じ内容・同じ金額の取引が複数あっても別の行として扱えるよう、出現回数もキーに含める
  const base = [date.toISOString().slice(0, 10), description, withdrawal, deposit, balance ?? ""].join("|");
  const occurrence = (seen.get(base) ?? 0) + 1;
  seen.set(base, occurrence);
  return { date, description, withdrawal, deposit, balance, fingerprint: createHash("sha256").update(`${base}|${occurrence}`).digest("hex") };
}

// クレジットカードの利用明細。「利用日・利用店名・利用金額」の列を探す。
// 見出しの行がないカード会社(1列目が日付、2列目が店名、3列目が金額)にも対応する。
// 金額がプラスなら利用(未払金が増える)、マイナスなら返品・取消(未払金が減る)として扱う。
const CARD_ALIASES = {
  date: ["利用日", "ご利用日", "利用年月日", "ご利用年月日", "日付", "取引日", "ご利用日付"],
  description: ["利用店名", "ご利用店名", "利用店名・商品名", "ご利用店名・商品名", "ご利用先", "利用先", "ご利用内容", "利用内容", "店名", "摘要", "内容", "ご利用店名(海外ご利用先)"],
  amount: ["利用金額", "ご利用金額", "利用金額(円)", "ご利用金額(円)", "金額", "請求金額", "お支払金額", "支払総額"],
} as const;

export function parseCardStatement(text: string): StatementRow[] {
  const table = parseCsv(text);
  const clean = (c: string) => c.normalize("NFKC").trim();
  const headerIndex = table.findIndex((row) => {
    const cells = row.map(clean);
    return CARD_ALIASES.date.some((a) => cells.includes(a)) && CARD_ALIASES.amount.some((a) => cells.includes(a));
  });
  const find = (header: string[], names: readonly string[]) => {
    // 見出しの候補は前にあるものを優先する(「利用金額」と「支払総額」が両方あれば利用金額を使う)
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  let col = { date: 0, description: 1, amount: 2 };
  let start = 0;
  if (headerIndex < 0) {
    // 銀行の入出金明細をカードに取り込もうとしたときは、見出しで気づけるようにする
    const bankWords: readonly string[] = [...ALIASES.withdrawal, ...ALIASES.deposit, ...ALIASES.balance];
    if (table.some((row) => row.some((c) => bankWords.includes(clean(c))))) {
      throw new Error("銀行の入出金明細のようです。上の「口座・カード」で銀行口座を選んでから取り込んでください。");
    }
  } else {
    const header = table[headerIndex].map(clean);
    col = { date: find(header, CARD_ALIASES.date), description: find(header, CARD_ALIASES.description), amount: find(header, CARD_ALIASES.amount) };
    start = headerIndex + 1;
  }

  const seen = new Map<string, number>();
  const rows: StatementRow[] = [];
  for (const row of table.slice(start)) {
    const rawDate = row[col.date]?.trim() ?? "";
    const date = rawDate ? parseStatementDate(rawDate) : null;
    // 見出しのないCSVは、名義や合計などの行が混ざるので、日付で始まる行だけを読む
    if (!date) {
      if (headerIndex >= 0 && rawDate && !/合計|小計|total/i.test(rawDate)) {
        throw new Error(`${table.indexOf(row) + 1}行目の日付を読み取れません: "${rawDate}"`);
      }
      continue;
    }
    const amount = toAmount(row[col.amount]);
    if (!amount) continue;
    const description = (col.description >= 0 ? row[col.description] ?? "" : "").trim() || "(利用先なし)";
    rows.push(makeRow(seen, date, description, amount > 0 ? amount : 0, amount < 0 ? -amount : 0, null));
  }
  if (rows.length === 0) {
    throw new Error("カードの利用明細のCSVとして読み取れません。「利用日」「利用店名」「利用金額」の列が必要です。");
  }
  return rows;
}
