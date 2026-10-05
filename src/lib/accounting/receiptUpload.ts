import type { ExpenseReport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { getAiProvider } from "@/lib/ai";
import { toDataUri } from "@/lib/fileToDataUri";
import { findOrCreateVendor } from "./parties";
import { postExpenseItemJournal } from "./automation";

// レシート・領収書の画像・PDFをAIで読み取り、経費精算の明細と仕訳を作る。経費精算の画面と AI受付箱 で使う。
export async function addReceiptToReport(report: ExpenseReport, base64: string, mediaType: string, override: { amount?: number | null; description?: string | null } = {}) {
  const extraction = await getAiProvider().extractReceipt({ imageBase64: base64, mediaType });
  const amount = override.amount ? override.amount : extraction.amount;
  if (!amount || amount <= 0) throw new UserError("金額を読み取れませんでした。金額を入れて登録してください");

  const vendor = extraction.vendorName ? await findOrCreateVendor(report.companyId, extraction.vendorName) : null;

  // A vendor's own default account (set on /vendors) is a stronger signal
  // than the AI's per-receipt guess, so it takes precedence when set.
  const account = vendor?.defaultExpenseAccountId
    ? await prisma.account.findUnique({ where: { id: vendor.defaultExpenseAccountId } })
    : await prisma.account.findUnique({ where: { companyId_code: { companyId: report.companyId, code: extraction.suggestedAccountCode } } });
  if (!account) throw new Error(`Suggested account code ${extraction.suggestedAccountCode} does not exist`);
  if (vendor?.defaultExpenseAccountId && account.id === vendor.defaultExpenseAccountId) {
    extraction.notes = [extraction.notes, `取引先の既定科目(${account.code} ${account.name})を適用しました。`].filter(Boolean).join(" ");
  }

  const aiExtraction = await prisma.aiExtraction.create({
    data: { companyId: report.companyId, sourceType: "EXPENSE_ITEM", rawResponse: extraction, confidence: extraction.confidence, suggestedAccountCode: extraction.suggestedAccountCode, status: "NEEDS_REVIEW" },
  });
  const item = await prisma.expenseItem.create({
    data: {
      expenseReportId: report.id,
      description: override.description || extraction.description,
      amount,
      expenseDate: new Date(extraction.expenseDate || Date.now()),
      vendorId: vendor?.id,
      accountId: account.id,
      receiptImageUrl: toDataUri(base64, mediaType),
      aiExtractionId: aiExtraction.id,
    },
  });
  const { decision } = await postExpenseItemJournal(item.id);
  await prisma.expenseReport.update({ where: { id: report.id }, data: { submittedAt: report.submittedAt ?? new Date(), totalAmount: { increment: amount } } });
  const updated = await prisma.expenseItem.findUnique({
    where: { id: item.id },
    include: { account: true, vendor: true, aiExtraction: true, journalEntry: { include: { lines: { include: { account: true } } } } },
  });
  return { item: updated!, decision };
}
