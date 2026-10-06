import type { InvoiceDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { getAiProvider } from "@/lib/ai";
import { toDataUri } from "@/lib/fileToDataUri";
import { findOrCreateCustomer, findOrCreateVendor } from "./parties";
import { postInvoiceJournal } from "./automation";
import { autoMatchImportedInvoice } from "@/lib/poMatching";

// 請求書の画像・PDFをAIで読み取り、請求書(下書き)と仕訳を作る。請求書の画面と AI受付箱 で使う。
export async function createInvoiceFromUpload(companyId: string, direction: InvoiceDirection, base64: string, mediaType: string) {
  const extraction = await (await getAiProvider(companyId)).extractInvoice({ imageBase64: base64, mediaType, direction });

  const subtotalAmount = extraction.subtotalAmount ?? 0;
  const taxAmount = extraction.taxAmount ?? 0;
  const totalAmount = extraction.totalAmount ?? subtotalAmount + taxAmount;
  if (totalAmount <= 0) throw new UserError("請求書の金額を読み取れませんでした");

  const vendor = direction === "RECEIVED" && extraction.counterpartyName ? await findOrCreateVendor(companyId, extraction.counterpartyName) : null;
  const customer = direction === "ISSUED" && extraction.counterpartyName ? await findOrCreateCustomer(companyId, extraction.counterpartyName) : null;

  // A vendor's own default account (set on /vendors) is a stronger signal
  // than the AI's per-invoice guess, so it takes precedence when set.
  if (direction === "RECEIVED" && vendor?.defaultExpenseAccountId) {
    const defaultAccount = await prisma.account.findUnique({ where: { id: vendor.defaultExpenseAccountId } });
    if (defaultAccount) {
      extraction.suggestedAccountCode = defaultAccount.code;
      extraction.notes = [extraction.notes, `取引先の既定科目(${defaultAccount.code} ${defaultAccount.name})を適用しました。`].filter(Boolean).join(" ");
    }
  }

  const aiExtraction = await prisma.aiExtraction.create({
    data: { companyId, sourceType: "INVOICE", rawResponse: extraction, confidence: extraction.confidence, suggestedAccountCode: extraction.suggestedAccountCode, status: "NEEDS_REVIEW" },
  });

  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      direction,
      status: "DRAFT",
      invoiceNumber: extraction.invoiceNumber,
      vendorId: vendor?.id,
      customerId: customer?.id,
      issueDate: extraction.issueDate ? new Date(extraction.issueDate) : new Date(),
      dueDate: extraction.dueDate ? new Date(extraction.dueDate) : null,
      subtotalAmount,
      taxAmount,
      totalAmount,
      sourceFileUrl: toDataUri(base64, mediaType),
      aiExtractionId: aiExtraction.id,
    },
  });

  const { decision } = await postInvoiceJournal(invoice.id);
  // 受け取った請求書: 同じ取引先の発注書と金額がぴったりなら、その発注書を自動で検収済みにする
  const matchedOrder = direction === "RECEIVED" ? await autoMatchImportedInvoice(companyId, invoice.id) : null;
  const updated = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    include: { vendor: true, customer: true, aiExtraction: true, journalEntry: { include: { lines: { include: { account: true } } } } },
  });
  return { invoice: updated!, decision, matchedOrder };
}
