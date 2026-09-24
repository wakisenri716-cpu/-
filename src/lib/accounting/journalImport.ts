import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/csvParse";
import { parseStatementDate } from "@/lib/bank/statement";

// 他の会計ソフトから書き出した仕訳や、Excelで作った仕訳を取り込む。
// 1行 = 借方1つ・貸方1つ。同じ伝票番号の行は1つの仕訳(複合仕訳)にまとめる(伝票番号がなければ1行1仕訳)。
export class ImportError extends Error {}

const MAX_ROWS = 2000;

const COLUMNS = {
  date: ["日付", "取引日", "伝票日付", "計上日"],
  voucher: ["伝票番号", "伝票no", "伝票no.", "仕訳番号", "取引no"],
  debitAccount: ["借方勘定科目", "借方科目"],
  debitAmount: ["借方金額", "借方金額(円)"],
  creditAccount: ["貸方勘定科目", "貸方科目"],
  creditAmount: ["貸方金額", "貸方金額(円)"],
  description: ["摘要", "取引内容", "内容"],
} as const;

function norm(s: string) {
  return s.normalize("NFKC").trim().toLowerCase().replace(/\s/g, "");
}

function amount(value: string | undefined) {
  const v = (value ?? "").normalize("NFKC").replace(/[¥,\s円]/g, "");
  if (v === "") return 0;
  return /^\d+$/.test(v) ? Number(v) : NaN;
}

export type ImportedEntry = {
  key: string;
  rowNumbers: number[];
  date: string;
  description: string;
  lines: { accountId: string; accountLabel: string; debit: number; credit: number }[];
  total: number;
  duplicate: boolean;
};

export async function parseJournalCsv(companyId: string, text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ImportError("CSVにデータがありません(1行目は見出し、2行目から仕訳)");
  const header = rows[0].map(norm);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => (names as readonly string[]).map(norm).includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  const missing = (["date", "debitAccount", "debitAmount", "creditAccount", "creditAmount"] as const).filter((k) => col[k] < 0);
  if (missing.length) {
    throw new ImportError(`見出しに ${missing.map((k) => COLUMNS[k][0]).join("・")} の列が見つかりません。サンプルCSVの形式に合わせてください`);
  }
  const body = rows.slice(1);
  if (body.length > MAX_ROWS) throw new ImportError(`一度に取り込めるのは${MAX_ROWS}行までです`);

  // 勘定科目はコード(例: 5060)でも名前(例: 地代家賃)でも指定できる
  const accounts = await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true } });
  const byKey = new Map<string, (typeof accounts)[number]>();
  for (const a of accounts) {
    byKey.set(norm(a.code), a);
    byKey.set(norm(a.name), a);
  }

  const errors: string[] = [];
  const broken = new Set<string>(); // 行にエラーがある仕訳は、貸借の不一致をさらに報告しない
  const groups = new Map<string, ImportedEntry>();
  body.forEach((r, i) => {
    const rowNumber = i + 2;
    const cell = (k: keyof typeof COLUMNS) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
    const voucher = cell("voucher");
    const key = voucher ? `v:${voucher}` : `r:${rowNumber}`;
    const group = groups.get(key);
    const dateValue = cell("date");
    const date = dateValue ? parseStatementDate(dateValue) : null;
    if (!group && !date) {
      errors.push(`${rowNumber}行目: 日付「${dateValue}」を読み取れません`);
      return;
    }
    const entry =
      group ??
      ({ key, rowNumbers: [], date: date!.toISOString().slice(0, 10), description: "", lines: [], total: 0, duplicate: false } satisfies ImportedEntry);
    entry.rowNumbers.push(rowNumber);
    if (!entry.description && cell("description")) entry.description = cell("description");

    for (const side of ["debit", "credit"] as const) {
      const name = cell(side === "debit" ? "debitAccount" : "creditAccount");
      const value = amount(cell(side === "debit" ? "debitAmount" : "creditAmount"));
      if (!name && !value) continue;
      if (Number.isNaN(value)) {
        errors.push(`${rowNumber}行目: ${side === "debit" ? "借方" : "貸方"}金額は0以上の整数で入力してください`);
        broken.add(key);
        continue;
      }
      const account = byKey.get(norm(name));
      if (!account) {
        errors.push(`${rowNumber}行目: 勘定科目「${name}」が見つかりません(科目コードか科目名で指定してください)`);
        broken.add(key);
        continue;
      }
      if (value === 0) continue;
      entry.lines.push({
        accountId: account.id,
        accountLabel: `${account.code} ${account.name}`,
        debit: side === "debit" ? value : 0,
        credit: side === "credit" ? value : 0,
      });
    }
    groups.set(key, entry);
  });

  const entries = [...groups.values()];
  for (const e of entries) {
    const debit = e.lines.reduce((s, l) => s + l.debit, 0);
    const credit = e.lines.reduce((s, l) => s + l.credit, 0);
    const where = e.rowNumbers.length > 1 ? `${e.rowNumbers[0]}〜${e.rowNumbers.at(-1)}行目` : `${e.rowNumbers[0]}行目`;
    if (broken.has(e.key)) continue;
    if (e.lines.length === 0) errors.push(`${where}: 金額が入っていません`);
    else if (debit !== credit) errors.push(`${where}: 借方合計(${debit.toLocaleString("ja-JP")})と貸方合計(${credit.toLocaleString("ja-JP")})が一致しません`);
    if (!e.description) e.description = "CSV取込";
    e.total = debit;
  }

  // 同じファイルを2回取り込んでも二重にならないよう、取込済みの仕訳と日付・摘要・金額が同じものは重複として飛ばす
  if (entries.length) {
    const dates = entries.map((e) => new Date(`${e.date}T00:00:00Z`));
    const existing = await prisma.journalEntry.findMany({
      where: { companyId, sourceType: "IMPORT", status: { not: "VOID" }, date: { in: dates } },
      select: { date: true, description: true, lines: { select: { debit: true } } },
    });
    const seen = new Set(existing.map((x) => `${x.date.toISOString().slice(0, 10)}|${x.description}|${x.lines.reduce((s, l) => s + l.debit, 0)}`));
    for (const e of entries) e.duplicate = seen.has(`${e.date}|${e.description}|${e.total}`);
  }

  return { entries, errors };
}

// エラーが1つでもあれば何も取り込まない(途中まで入って帳簿が中途半端になるのを防ぐ)
export async function importJournalCsv(companyId: string, text: string) {
  const { entries, errors } = await parseJournalCsv(companyId, text);
  if (errors.length) throw new ImportError(`取り込めない行があります: ${errors.slice(0, 5).join(" / ")}${errors.length > 5 ? ` ほか${errors.length - 5}件` : ""}`);
  const toImport = entries.filter((e) => !e.duplicate);
  await prisma.$transaction(
    toImport.map((e) =>
      prisma.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${e.date}T00:00:00Z`),
          description: e.description,
          sourceType: "IMPORT",
          status: "POSTED_MANUALLY",
          lines: { create: e.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })) },
        },
      }),
    ),
  );
  return { imported: toImport.length, skipped: entries.length - toImport.length };
}

export const SAMPLE_CSV = [
  ["日付", "伝票番号", "借方勘定科目", "借方金額", "貸方勘定科目", "貸方金額", "摘要"],
  ["2026/04/01", "1", "普通預金", "1000000", "資本金", "1000000", "資本金の払込"],
  ["2026/04/25", "2", "地代家賃", "100000", "普通預金", "100000", "4月分 事務所家賃"],
  ["2026/04/30", "3", "借入金", "50000", "", "", "借入金の返済"],
  ["2026/04/30", "3", "支払利息", "2000", "普通預金", "52000", ""],
  ["2026/05/10", "", "5040", "5500", "1020", "5500", "インターネット回線"],
];
