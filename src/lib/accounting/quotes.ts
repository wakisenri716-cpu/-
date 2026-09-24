import { prisma } from "@/lib/prisma";
import { findOrCreateCustomer } from "./parties";
import { calcInvoice, InvoiceError, issueInvoice, validDate, validateLines, type InvoiceLineInput } from "./issueInvoice";

export type QuoteInput = {
  customerName: string;
  issueDate: string;
  validUntil: string;
  lines: InvoiceLineInput[];
  notes?: string | null;
};

async function nextQuoteNumber(companyId: string, issueDate: string) {
  const prefix = `QT-${issueDate.slice(0, 4)}${issueDate.slice(5, 7)}-`;
  const last = await prisma.quote.findFirst({
    where: { companyId, quoteNumber: { startsWith: prefix } },
    orderBy: { quoteNumber: "desc" },
    select: { quoteNumber: true },
  });
  const seq = last ? Number(last.quoteNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// 見積書は金額の約束だけなので仕訳は作らない
export async function createQuote(companyId: string, input: QuoteInput) {
  if (!input.customerName.trim()) throw new InvoiceError("見積先を入力してください");
  if (!validDate(input.issueDate)) throw new InvoiceError("見積日を正しく入力してください");
  if (!validDate(input.validUntil)) throw new InvoiceError("有効期限を正しく入力してください");
  if (input.validUntil < input.issueDate) throw new InvoiceError("有効期限は見積日以降にしてください");
  const calc = calcInvoice(validateLines(input.lines));
  if (calc.total <= 0) throw new InvoiceError("合計金額が0円の見積書は作成できません");
  const customer = await findOrCreateCustomer(companyId, input.customerName.trim());

  // 同時に作成されて番号が重複した場合は、一意制約のエラーを受けて採番し直す
  for (let attempt = 0; attempt < 3; attempt++) {
    const quoteNumber = await nextQuoteNumber(companyId, input.issueDate);
    try {
      return await prisma.quote.create({
        data: {
          companyId,
          quoteNumber,
          customerId: customer.id,
          issueDate: new Date(`${input.issueDate}T00:00:00Z`),
          validUntil: new Date(`${input.validUntil}T00:00:00Z`),
          subtotalAmount: calc.subtotal,
          taxAmount: calc.tax,
          totalAmount: calc.total,
          notes: input.notes?.trim() || null,
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
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new InvoiceError("見積書番号の採番に失敗しました。もう一度お試しください");
}

export async function listQuotes(companyId: string) {
  return prisma.quote.findMany({
    where: { companyId },
    include: { customer: { select: { name: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
    orderBy: [{ issueDate: "desc" }, { quoteNumber: "desc" }],
  });
}

export async function getQuote(companyId: string, id: string) {
  const quote = await prisma.quote.findFirst({
    where: { id, companyId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      customer: true,
      company: true,
      invoice: { select: { id: true, invoiceNumber: true } },
    },
  });
  if (!quote) return null;
  return { quote, calc: calcInvoice(quote.lines) };
}

// 見積書の明細・宛先をそのまま使って請求書を作る(売上の仕訳も自動)
export async function convertQuoteToInvoice(companyId: string, id: string, dates: { issueDate: string; dueDate: string }) {
  const data = await getQuote(companyId, id);
  if (!data) throw new InvoiceError("見積書が見つかりません");
  const { quote } = data;
  if (quote.status === "INVOICED") throw new InvoiceError("この見積書はすでに請求書にしています");
  if (quote.status === "CANCELLED") throw new InvoiceError("取り消した見積書は請求書にできません");

  // 2回押されても請求書が2枚できないよう、先に「請求済み」を確保してから作る
  const claimed = await prisma.quote.updateMany({ where: { id, companyId, status: "OPEN" }, data: { status: "INVOICED" } });
  if (claimed.count !== 1) throw new InvoiceError("状態が変わりました。画面を更新してもう一度お試しください");
  try {
    const invoice = await issueInvoice(companyId, {
      customerName: quote.customer.name,
      issueDate: dates.issueDate,
      dueDate: dates.dueDate,
      notes: quote.notes,
      lines: quote.lines,
    });
    await prisma.quote.update({ where: { id }, data: { invoiceId: invoice.id } });
    return invoice;
  } catch (error) {
    await prisma.quote.update({ where: { id }, data: { status: "OPEN" } });
    throw error;
  }
}

export async function cancelQuote(companyId: string, id: string) {
  const updated = await prisma.quote.updateMany({ where: { id, companyId, status: "OPEN" }, data: { status: "CANCELLED" } });
  if (updated.count !== 1) throw new InvoiceError("請求書にした見積書・取り消した見積書は取り消せません");
}
