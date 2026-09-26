import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

// 電子帳簿保存法の対応: 訂正・削除の履歴の表示と、証憑ファイルの改ざんチェック。
// 履歴そのものはデータベースのトリガーが自動で書き込む(prisma/migrations/*_add_record_history)。

export const TABLE_LABELS: Record<string, string> = {
  JournalEntry: "仕訳",
  JournalLine: "仕訳の明細",
  ExpenseItem: "経費(レシート)",
  Invoice: "請求書",
  InvoiceLine: "請求書の明細",
  Payment: "入金・支払",
  StoredFile: "書類フォルダのファイル",
};

export const ACTION_LABELS: Record<string, string> = { INSERT: "登録", UPDATE: "訂正", DELETE: "削除" };

const FIELD_LABELS: Record<string, string> = {
  status: "状態",
  date: "日付",
  description: "摘要・内容",
  amount: "金額",
  totalAmount: "合計金額",
  subtotalAmount: "税抜金額",
  taxAmount: "消費税",
  debit: "借方",
  credit: "貸方",
  accountId: "勘定科目",
  memo: "メモ",
  departmentId: "部門",
  expenseDate: "日付",
  vendorId: "取引先",
  customerId: "顧客",
  invoiceNumber: "請求書番号",
  issueDate: "発行日",
  dueDate: "支払期限",
  paymentDate: "入金・支払日",
  invoiceId: "請求書",
  journalEntryId: "仕訳",
  name: "名前",
  folderId: "フォルダ",
  expiresOn: "期限",
  receiptFileDigest: "レシート画像",
  sourceFileDigest: "請求書のファイル",
  correctsInvoiceId: "訂正元の請求書",
  notes: "備考",
};

// 画面に並べる必要のない列(内部の日時など)
const HIDDEN = new Set(["updatedAt", "createdAt", "companyId", "id"]);

function short(value: unknown) {
  if (value === null || value === undefined) return "(なし)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  // 日時は日付だけ、長い値は切り詰める
  const date = text.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z?$/);
  if (date) return date[1];
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

type Row = Record<string, unknown>;

function describe(table: string, row: Row | null) {
  if (!row) return "";
  const pick = (k: string) => (row[k] === null || row[k] === undefined ? "" : String(row[k]));
  switch (table) {
    case "JournalEntry":
      return `${pick("date").slice(0, 10)} ${pick("description")}`;
    case "JournalLine":
      return `借方 ${pick("debit")} / 貸方 ${pick("credit")}${pick("memo") ? ` ${pick("memo")}` : ""}`;
    case "ExpenseItem":
      return `${pick("expenseDate").slice(0, 10)} ${pick("description")} ${pick("amount")}円`;
    case "Invoice":
      return `${pick("invoiceNumber") || "(番号なし)"} ${pick("totalAmount")}円`;
    case "InvoiceLine":
      return `${pick("description")} ${pick("amount")}円`;
    case "Payment":
      return `${pick("paymentDate").slice(0, 10)} ${pick("amount")}円`;
    case "StoredFile":
      return pick("name");
    default:
      return "";
  }
}

export async function listRecordHistory(companyId: string, opts: { changesOnly?: boolean; table?: string; take?: number } = {}) {
  const rows = await prisma.recordHistory.findMany({
    where: {
      companyId,
      ...(opts.changesOnly ? { action: { in: ["UPDATE", "DELETE"] } } : {}),
      ...(opts.table && TABLE_LABELS[opts.table] ? { tableName: opts.table } : {}),
    },
    orderBy: { id: "desc" },
    take: Math.min(opts.take ?? 200, 500),
  });
  return rows.map((r) => {
    const oldData = (r.oldData ?? null) as Row | null;
    const newData = (r.newData ?? null) as Row | null;
    const changes =
      r.action === "UPDATE" && oldData && newData
        ? Object.keys({ ...oldData, ...newData })
            .filter((k) => !HIDDEN.has(k) && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]))
            .map((k) => ({ field: FIELD_LABELS[k] ?? k, before: short(oldData[k]), after: short(newData[k]) }))
        : [];
    return {
      id: r.id.toString(),
      changedAt: r.changedAt,
      table: TABLE_LABELS[r.tableName] ?? r.tableName,
      action: ACTION_LABELS[r.action] ?? r.action,
      rawAction: r.action,
      recordId: r.recordId,
      summary: describe(r.tableName, newData ?? oldData),
      changes,
    };
  });
}

export async function historyStats(companyId: string) {
  const [total, changes, first] = await Promise.all([
    prisma.recordHistory.count({ where: { companyId } }),
    prisma.recordHistory.count({ where: { companyId, action: { in: ["UPDATE", "DELETE"] } } }),
    prisma.recordHistory.findFirst({ where: { companyId }, orderBy: { id: "asc" }, select: { changedAt: true } }),
  ]);
  return { total, changes, since: first?.changedAt ?? null };
}

const sha256 = (data: Uint8Array | Buffer) => createHash("sha256").update(data).digest("hex");

function dataUriBytes(uri: string | null) {
  const m = uri?.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=\s]*)$/);
  return m ? Buffer.from(m[1], "base64") : null;
}

export type VerifyProblem = { kind: string; id: string; label: string; problem: "mismatch" | "noHash" };

// 登録したときの指紋(SHA-256)と、いま保存されている中身の指紋を比べる。1件ずつ読むので件数が多いと少し時間がかかる。
export async function verifyEvidence(companyId: string) {
  const problems: VerifyProblem[] = [];
  let checked = 0;
  const check = (kind: string, id: string, label: string, stored: string | null, bytes: Uint8Array | Buffer | null) => {
    if (!bytes) return;
    checked++;
    if (!stored) problems.push({ kind, id, label, problem: "noHash" });
    else if (stored !== sha256(bytes)) problems.push({ kind, id, label, problem: "mismatch" });
  };

  const receipts = await prisma.expenseItem.findMany({ where: { expenseReport: { companyId }, receiptImageUrl: { not: null } }, select: { id: true } });
  for (const { id } of receipts) {
    const r = await prisma.expenseItem.findUnique({ where: { id }, select: { receiptImageUrl: true, receiptSha256: true, description: true, expenseDate: true, amount: true } });
    if (r) check("領収書(経費)", id, `${r.expenseDate.toISOString().slice(0, 10)} ${r.description} ${r.amount}円`, r.receiptSha256, dataUriBytes(r.receiptImageUrl));
  }
  const invoices = await prisma.invoice.findMany({ where: { companyId, sourceFileUrl: { not: null } }, select: { id: true } });
  for (const { id } of invoices) {
    const r = await prisma.invoice.findUnique({ where: { id }, select: { sourceFileUrl: true, sourceSha256: true, invoiceNumber: true, totalAmount: true } });
    if (r) check("受け取った請求書", id, `${r.invoiceNumber ?? "(番号なし)"} ${r.totalAmount}円`, r.sourceSha256, dataUriBytes(r.sourceFileUrl));
  }
  const files = await prisma.storedFile.findMany({ where: { companyId }, select: { id: true } });
  for (const { id } of files) {
    const r = await prisma.storedFile.findUnique({ where: { id }, select: { data: true, sha256: true, name: true } });
    if (r) check("書類フォルダ", id, r.name, r.sha256, r.data);
  }
  return { checked, ok: checked - problems.length, problems, checkedAt: new Date() };
}
