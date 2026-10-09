import { prisma } from "@/lib/prisma";
import { checkInvoice } from "@/lib/invoiceCheck";
import { parseCsv } from "@/lib/csvParse";
import { UserError } from "@/lib/errors";
import { calcInvoice, issueInvoice, validDate, validateLines, type InvoiceLineInput } from "./issueInvoice";
import { buildDraft, sendDocumentMail } from "@/lib/documentMail";
import { endOfNextMonth, termsDueDate } from "@/lib/customerTerms";

// 請求書のCSV一括作成と、まだ送っていない請求書のまとめてメール送信。
// CSVは1行が明細1行。「まとめ」の列(なければ 請求先・請求日・支払期限 が同じ行)で1枚の請求書にまとめる。
// エラーが1つでもあれば何も作らない。

const MAX_ROWS = 1000;
const MAX_INVOICES = 300;
const MAX_SEND = 100;

export const INVOICE_SAMPLE = [
  ["まとめ", "請求先", "メールアドレス", "請求日", "支払期限", "品目", "数量", "単位", "単価", "税率", "備考"],
  ["1", "株式会社お客様商事", "keiri@example.com", "2026/10/31", "2026/11/30", "10月分 保守費用", "1", "式", "50000", "10", "いつもありがとうございます"],
  ["1", "株式会社お客様商事", "", "2026/10/31", "2026/11/30", "追加作業", "3", "時間", "8000", "10", ""],
  ["2", "サンプル食品株式会社", "", "2026/10/31", "2026/11/30", "お弁当(軽減税率)", "20", "個", "650", "8", ""],
];

const COLUMNS: Record<string, string[]> = {
  key: ["まとめ", "グループ", "請求書のまとめ"],
  customer: ["請求先", "顧客", "顧客名", "取引先"],
  email: ["メールアドレス", "メール", "email"],
  issueDate: ["請求日", "発行日"],
  dueDate: ["支払期限", "お支払期限", "期日"],
  description: ["品目", "品名", "内容", "摘要"],
  quantity: ["数量"],
  unit: ["単位"],
  unitPrice: ["単価"],
  taxRate: ["税率"],
  notes: ["備考"],
};
// 支払期限は空でもよい(顧客の支払条件、なければ翌月末にする)
const REQUIRED = ["customer", "issueDate", "description", "unitPrice"];

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s/g, "");

// 2026/10/1・2026-10-01・2026年10月1日 → 2026-10-01
function toDate(v: string) {
  const m = v.normalize("NFKC").trim().match(/^(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})日?$/);
  if (!m) return null;
  const key = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return validDate(key) && new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key ? key : null;
}

export type ImportedInvoice = {
  key: string;
  customerName: string;
  email: string | null;
  issueDate: string;
  dueDate: string;
  notes: string | null;
  lines: InvoiceLineInput[];
  rows: number[];
  subtotal: number;
  tax: number;
  total: number;
  newCustomer: boolean;
};

export async function previewInvoiceImport(companyId: string, text: string) {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (table.length < 2) throw new UserError("CSVにデータがありません(1行目は見出し、2行目から)");
  if (table.length - 1 > MAX_ROWS) throw new UserError(`一度に読み込めるのは${MAX_ROWS}行までです`);
  const header = table[0].map(norm);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.map(norm).includes(h))]));
  const missing = REQUIRED.filter((k) => col[k] < 0);
  if (missing.length) throw new UserError(`見出しに ${missing.map((k) => COLUMNS[k][0]).join("・")} の列が見つかりません。サンプルCSVの形式に合わせてください`);

  const errors: string[] = [];
  const groups = new Map<string, { inv: Omit<ImportedInvoice, "subtotal" | "tax" | "total" | "newCustomer">; bad: boolean }>();
  table.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const get = (k: string) => (col[k] >= 0 ? (r[col[k]] ?? "").normalize("NFKC").trim() : "");
    const customerName = get("customer").slice(0, 100);
    const issueDate = toDate(get("issueDate"));
    const dueRaw = get("dueDate");
    const dueDate = dueRaw ? toDate(dueRaw) : "";
    const rowErrors: string[] = [];
    if (!customerName) rowErrors.push("請求先が空です");
    if (!issueDate) rowErrors.push("請求日が正しくありません");
    if (dueRaw && !dueDate) rowErrors.push("支払期限が正しくありません");
    if (issueDate && dueDate && dueDate < issueDate) rowErrors.push("支払期限が請求日より前です");
    const quantity = get("quantity") === "" ? 1 : Number(get("quantity").replace(/,/g, ""));
    const unitPrice = Number(get("unitPrice").replace(/[,¥円]/g, ""));
    const taxRate = get("taxRate") === "" ? 10 : Number(get("taxRate").replace(/[%%].*$/, "").replace(/[^\d.]/g, ""));
    const line: InvoiceLineInput = { description: get("description").slice(0, 200), quantity, unit: get("unit").slice(0, 10) || null, unitPrice, taxRate };
    try {
      validateLines([line]);
    } catch (e) {
      rowErrors.push((e as Error).message.replace(/^1行目の/, ""));
    }
    const key = get("key") || `${customerName}|${issueDate}|${dueDate}`;
    const g = groups.get(key);
    if (g && (g.inv.customerName !== customerName || g.inv.issueDate !== issueDate || g.inv.dueDate !== dueDate)) rowErrors.push(`まとめ「${get("key")}」の中で請求先・請求日・支払期限が違います`);
    if (rowErrors.length) errors.push(`${rowNumber}行目: ${rowErrors.join("・")}`);
    const email = get("email") || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`${rowNumber}行目: メールアドレスが正しくありません`);
    if (g) {
      g.inv.lines.push(line);
      g.inv.rows.push(rowNumber);
      g.inv.email ??= email;
      g.inv.notes ??= get("notes") || null;
      g.bad ||= rowErrors.length > 0;
    } else {
      groups.set(key, { inv: { key, customerName, email, issueDate: issueDate ?? "", dueDate: dueDate ?? "", notes: get("notes") || null, lines: [line], rows: [rowNumber] }, bad: rowErrors.length > 0 });
    }
  });
  if (groups.size > MAX_INVOICES) errors.push(`一度に作れる請求書は${MAX_INVOICES}枚までです(${groups.size}枚あります)`);

  const existing = new Set((await prisma.customer.findMany({ where: { companyId }, select: { name: true } })).map((c) => c.name));
  const invoices: ImportedInvoice[] = [];
  for (const { inv, bad } of groups.values()) {
    // 支払期限が空なら、顧客の支払条件(なければ翌月末)
    if (!inv.dueDate && inv.issueDate) inv.dueDate = (await termsDueDate(companyId, inv.customerName, inv.issueDate)) ?? endOfNextMonth(inv.issueDate);
    if (inv.lines.length > 50) errors.push(`${inv.customerName}: 1枚の請求書の明細は50行までです`);
    const calc = bad ? null : calcInvoice(inv.lines);
    if (calc && calc.total <= 0) errors.push(`${inv.rows[0]}行目〜: ${inv.customerName} の合計が0円です`);
    invoices.push({ ...inv, subtotal: calc?.subtotal ?? 0, tax: calc?.tax ?? 0, total: calc?.total ?? 0, newCustomer: !existing.has(inv.customerName) });
  }
  return { invoices, errors, total: invoices.reduce((s, i) => s + i.total, 0) };
}

export async function importInvoices(companyId: string, text: string) {
  const preview = await previewInvoiceImport(companyId, text);
  if (preview.errors.length) throw new UserError(`作れない行があります: ${preview.errors.slice(0, 5).join(" / ")}${preview.errors.length > 5 ? ` ほか${preview.errors.length - 5}件` : ""}`);
  const created = [];
  for (const inv of preview.invoices) {
    const invoice = await issueInvoice(companyId, { customerName: inv.customerName, issueDate: inv.issueDate, dueDate: inv.dueDate, lines: inv.lines, notes: inv.notes });
    // メールアドレスの列があれば顧客に覚える(まとめて送るときの宛先)
    if (inv.email && invoice.customerId) await prisma.customer.update({ where: { id: invoice.customerId }, data: { email: inv.email } });
    created.push({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerName: inv.customerName, total: invoice.totalAmount });
  }
  return { created, total: created.reduce((s, c) => s + c.total, 0) };
}

// まだ送っていない(確定のまま)請求書
export async function unsentInvoices(companyId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, direction: "ISSUED", status: "CONFIRMED" },
    include: { customer: { select: { name: true, email: true } } },
    orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
    take: 300,
  });
  // 送る前チェック(会社の設定の指摘はまとめて1回、請求書ごとの指摘は件数と最初の1つ)
  // 多いときは新しい100件だけ確かめる(データベースへの問い合わせを一度に出しすぎないよう10件ずつ)
  const checks: Awaited<ReturnType<typeof checkInvoice>>[] = [];
  for (let n = 0; n < Math.min(invoices.length, 100); n += 10) checks.push(...(await Promise.all(invoices.slice(n, n + 10).map((i) => checkInvoice(companyId, i.id)))));
  const companyIssues = (checks[0] ?? []).filter((x) => x.scope === "company").map((x) => ({ level: x.level, message: x.message }));
  return { companyIssues, invoices: invoices.map((i, n) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    check: checks[n]
      ? {
          errors: checks[n].filter((x) => x.scope === "invoice" && x.level === "error").length,
          warns: checks[n].filter((x) => x.scope === "invoice" && x.level === "warn").length,
          first: checks[n].find((x) => x.scope === "invoice" && x.level !== "info")?.message ?? null,
        }
      : null,
    customerName: i.customer?.name ?? "",
    email: i.customer?.email ?? null,
    issueDate: i.issueDate ? i.issueDate.toISOString().slice(0, 10) : null,
    dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
    total: i.totalAmount,
  })) };
}

// 選んだ請求書を、いつもの文面(共有リンクつき)でまとめて送る。宛先のない請求書は飛ばす
export async function sendInvoicesBulk(companyId: string, ids: unknown, baseUrl: string, sentByName: string) {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  if (list.length === 0) throw new UserError("送る請求書を選んでください");
  if (list.length > MAX_SEND) throw new UserError(`一度に送れるのは${MAX_SEND}件までです`);
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const id of list) {
    try {
      const draft = await buildDraft(companyId, "invoice", id, baseUrl);
      if (!draft.to) {
        results.push({ id, ok: false, message: "顧客のメールアドレスがありません" });
        continue;
      }
      const log = await sendDocumentMail(companyId, { kind: "invoice", id, to: draft.to, subject: draft.subject, body: draft.body }, sentByName);
      results.push({ id, ok: log.status !== "FAILED", message: log.status === "FAILED" ? (log.error ?? "送れませんでした") : `${log.to} に送りました` });
    } catch (error) {
      results.push({ id, ok: false, message: error instanceof Error ? error.message : "送れませんでした" });
      // 1日の上限に達したら残りは送らない
      if (error instanceof Error && error.message.includes("1日")) break;
    }
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
