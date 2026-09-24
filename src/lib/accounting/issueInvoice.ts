import { prisma } from "@/lib/prisma";
import { ensureAccount } from "./accounts";
import { findOrCreateCustomer } from "./parties";
import { UserError } from "@/lib/errors";

export class InvoiceError extends UserError {}

export const TAX_RATES = [10, 8] as const;

export type InvoiceLineInput = { description: string; quantity: number; unit?: string | null; unitPrice: number; taxRate: number };

// 適格請求書のルール: 明細ごとの金額(円未満切り捨て)を税率ごとに合計し、消費税の端数処理は税率ごとに1回だけ行う
export function calcInvoice(lines: InvoiceLineInput[]) {
  // 1.15 × 100 が 114.999… になるような小数の誤差で1円少なくならないよう、先に小数点以下6桁で丸める
  const priced = lines.map((l) => ({ ...l, amount: Math.floor(Math.round(l.quantity * l.unitPrice * 1e6) / 1e6) }));
  const byRate = TAX_RATES.map((rate) => {
    const base = priced.filter((l) => l.taxRate === rate).reduce((sum, l) => sum + l.amount, 0);
    return { rate, base, tax: Math.floor((base * rate) / 100) };
  }).filter((r) => r.base !== 0);
  const subtotal = byRate.reduce((s, r) => s + r.base, 0);
  const tax = byRate.reduce((s, r) => s + r.tax, 0);
  return { lines: priced, byRate, subtotal, tax, total: subtotal + tax };
}

export type IssueInvoiceInput = {
  customerName: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLineInput[];
  notes?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(value: string) {
  return DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function validate(input: IssueInvoiceInput) {
  if (!input.customerName.trim()) throw new InvoiceError("請求先を入力してください");
  if (!validDate(input.issueDate)) throw new InvoiceError("請求日を正しく入力してください");
  if (!validDate(input.dueDate)) throw new InvoiceError("支払期限を正しく入力してください");
  if (input.dueDate < input.issueDate) throw new InvoiceError("支払期限は請求日以降にしてください");
  return validateLines(input.lines);
}

// 明細の入力チェック。品目も単価も空の行は無視する(入力画面の空行)。
export function validateLines(input: InvoiceLineInput[]) {
  const lines = input.filter((l) => l.description.trim() || l.unitPrice);
  if (lines.length === 0) throw new InvoiceError("明細を1行以上入力してください");
  if (lines.length > 50) throw new InvoiceError("明細は50行までです");
  lines.forEach((l, i) => {
    if (!l.description.trim()) throw new InvoiceError(`${i + 1}行目の品目を入力してください`);
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new InvoiceError(`${i + 1}行目の数量を正しく入力してください`);
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new InvoiceError(`${i + 1}行目の単価は0以上の整数で入力してください`);
    if (!(TAX_RATES as readonly number[]).includes(l.taxRate)) throw new InvoiceError(`${i + 1}行目の税率を選択してください`);
  });
  return lines;
}

async function nextInvoiceNumber(companyId: string, issueDate: string) {
  const prefix = `INV-${issueDate.slice(0, 4)}${issueDate.slice(5, 7)}-`;
  const last = await prisma.invoice.findFirst({
    where: { companyId, direction: "ISSUED", invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  const seq = last?.invoiceNumber ? Number(last.invoiceNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export async function issueInvoice(companyId: string, input: IssueInvoiceInput) {
  const lines = validate(input);
  const calc = calcInvoice(lines);
  if (calc.total <= 0) throw new InvoiceError("合計金額が0円の請求書は作成できません");
  const customer = await findOrCreateCustomer(companyId, input.customerName.trim());

  // 同時に作成されて番号が重複した場合に備え、数回まで採番し直す
  for (let attempt = 0; attempt < 3; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(companyId, input.issueDate);
    const duplicate = await prisma.invoice.findFirst({ where: { companyId, direction: "ISSUED", invoiceNumber } });
    if (duplicate) continue;
    return prisma.$transaction(async (tx) => {
      const [receivable, sales, outputTax] = await Promise.all([
        ensureAccount(tx, companyId, "1110"),
        ensureAccount(tx, companyId, "4010"),
        ensureAccount(tx, companyId, "2110"),
      ]);
      const entry = await tx.journalEntry.create({
        data: {
          companyId,
          date: new Date(`${input.issueDate}T00:00:00Z`),
          description: `売上請求書発行: ${invoiceNumber} ${customer.name}`,
          sourceType: "INVOICE",
          status: "AUTO_POSTED",
          createdByAi: false,
          lines: {
            create: [
              { accountId: receivable.id, debit: calc.total, credit: 0, memo: "売掛金計上" },
              { accountId: sales.id, debit: 0, credit: calc.subtotal, memo: "売上計上" },
              ...(calc.tax > 0 ? [{ accountId: outputTax.id, debit: 0, credit: calc.tax, memo: "仮受消費税" }] : []),
            ],
          },
        },
      });
      return tx.invoice.create({
        data: {
          companyId,
          direction: "ISSUED",
          status: "CONFIRMED",
          invoiceNumber,
          customerId: customer.id,
          issueDate: new Date(`${input.issueDate}T00:00:00Z`),
          dueDate: new Date(`${input.dueDate}T00:00:00Z`),
          subtotalAmount: calc.subtotal,
          taxAmount: calc.tax,
          totalAmount: calc.total,
          notes: input.notes?.trim() || null,
          journalEntryId: entry.id,
          lines: {
            create: calc.lines.map((l, i) => ({
              sortOrder: i,
              description: l.description.trim(),
              quantity: l.quantity,
              unit: l.unit?.trim() || null,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              amount: l.amount,
            })),
          },
        },
      });
    });
  }
  throw new InvoiceError("請求書番号の採番に失敗しました。もう一度お試しください");
}

export async function getPrintableInvoice(companyId: string, id: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId, direction: "ISSUED" },
    include: { lines: { orderBy: { sortOrder: "asc" } }, customer: true, payments: true, company: true },
  });
  if (!invoice || invoice.lines.length === 0) return null;
  return { invoice, calc: calcInvoice(invoice.lines) };
}

const REGISTRATION = /^T\d{13}$/;

export type CompanyInfoInput = {
  name: string;
  registrationNumber: string;
  address: string;
  phone: string;
  bankAccount: string;
  invoiceNote: string;
};

export async function updateCompanyInfo(companyId: string, input: CompanyInfoInput) {
  const name = input.name.trim();
  if (!name) throw new InvoiceError("会社名を入力してください");
  const registrationNumber = input.registrationNumber.trim().toUpperCase().normalize("NFKC");
  if (registrationNumber && !REGISTRATION.test(registrationNumber)) {
    throw new InvoiceError("登録番号は「T」と13桁の数字で入力してください(例: T1234567890123)");
  }
  const clean = (v: string) => v.trim() || null;
  return prisma.company.update({
    where: { id: companyId },
    data: {
      name,
      registrationNumber: registrationNumber || null,
      address: clean(input.address),
      phone: clean(input.phone),
      bankAccount: clean(input.bankAccount),
      invoiceNote: clean(input.invoiceNote),
    },
  });
}

// 作成した請求書の取消。入金がまだ1円もない場合だけ、請求書を「取消」にして売上の仕訳を無効にする。
export async function cancelIssuedInvoice(companyId: string, id: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId, direction: "ISSUED" },
    include: { _count: { select: { lines: true, payments: true } } },
  });
  if (!invoice || invoice._count.lines === 0) throw new InvoiceError("請求書が見つかりません");
  if (invoice.status === "CANCELLED") throw new InvoiceError("この請求書はすでに取り消されています");
  if (invoice._count.payments > 0) throw new InvoiceError("入金が記録されている請求書は取り消せません");

  return prisma.$transaction(async (tx) => {
    // 取消と入金の記録が同時に行われても食い違わないよう、「入金なし・未取消」を条件に更新する
    const updated = await tx.invoice.updateMany({
      where: { id, companyId, status: { not: "CANCELLED" }, payments: { none: {} } },
      data: { status: "CANCELLED" },
    });
    if (updated.count !== 1) throw new InvoiceError("状態が変わりました。画面を更新してもう一度お試しください");
    if (invoice.journalEntryId) {
      await tx.journalEntry.updateMany({ where: { id: invoice.journalEntryId, companyId }, data: { status: "VOID" } });
    }
    return tx.invoice.findUniqueOrThrow({ where: { id } });
  });
}

// APIで受け取った明細(文字列の数値なども来る)を InvoiceLineInput に揃える
export function parseLines(raw: unknown): InvoiceLineInput[] {
  const lines = Array.isArray(raw) ? raw : [];
  return lines.map((l: Record<string, unknown>) => ({
    description: String(l?.description ?? ""),
    quantity: Number(l?.quantity),
    unit: l?.unit ? String(l.unit) : null,
    unitPrice: Number(l?.unitPrice),
    taxRate: Number(l?.taxRate),
  }));
}

// 既存の請求書・見積書の明細を、入力画面の初期値(文字列)に変換する(複製用)
export function toFormLines(lines: { description: string; quantity: number; unit: string | null; unitPrice: number; taxRate: number }[]) {
  return lines.map((l) => ({
    description: l.description,
    quantity: String(l.quantity),
    unit: l.unit ?? "",
    unitPrice: String(l.unitPrice),
    taxRate: String(l.taxRate),
  }));
}
