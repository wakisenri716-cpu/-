import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAiProvider } from "@/lib/ai";
import { fileToBase64, toDataUri } from "@/lib/fileToDataUri";
import { findOrCreateVendor } from "@/lib/accounting/parties";
import { postExpenseItemJournal } from "@/lib/accounting/automation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: expenseReportId } = await params;

  const report = await prisma.expenseReport.findUnique({ where: { id: expenseReportId } });
  if (!report) {
    return NextResponse.json({ error: "Expense report not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const receipt = formData.get("receipt");
  if (!(receipt instanceof File) || receipt.size === 0) {
    return NextResponse.json({ error: "receipt file is required" }, { status: 400 });
  }

  const { base64, mediaType } = await fileToBase64(receipt);
  const extraction = await getAiProvider().extractReceipt({ imageBase64: base64, mediaType });

  const amountOverride = formData.get("amount");
  const amount = amountOverride ? Number(amountOverride) : extraction.amount;
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Could not determine an amount; please enter it manually" }, { status: 422 });
  }

  const vendor = extraction.vendorName
    ? await findOrCreateVendor(report.companyId, extraction.vendorName)
    : null;

  // A vendor's own default account (set on /vendors) is a stronger signal
  // than the AI's per-receipt guess, so it takes precedence when set.
  const account = vendor?.defaultExpenseAccountId
    ? await prisma.account.findUnique({ where: { id: vendor.defaultExpenseAccountId } })
    : await prisma.account.findUnique({
        where: { companyId_code: { companyId: report.companyId, code: extraction.suggestedAccountCode } },
      });
  if (!account) {
    return NextResponse.json(
      { error: `Suggested account code ${extraction.suggestedAccountCode} does not exist` },
      { status: 500 },
    );
  }
  if (vendor?.defaultExpenseAccountId && account.id === vendor.defaultExpenseAccountId) {
    extraction.notes = [extraction.notes, `取引先の既定科目(${account.code} ${account.name})を適用しました。`]
      .filter(Boolean)
      .join(" ");
  }

  const aiExtraction = await prisma.aiExtraction.create({
    data: {
      companyId: report.companyId,
      sourceType: "EXPENSE_ITEM",
      rawResponse: extraction,
      confidence: extraction.confidence,
      suggestedAccountCode: extraction.suggestedAccountCode,
      status: "NEEDS_REVIEW",
    },
  });

  const item = await prisma.expenseItem.create({
    data: {
      expenseReportId,
      description: (formData.get("description") as string) || extraction.description,
      amount,
      expenseDate: new Date(extraction.expenseDate || Date.now()),
      vendorId: vendor?.id,
      accountId: account.id,
      receiptImageUrl: toDataUri(base64, mediaType),
      aiExtractionId: aiExtraction.id,
    },
  });

  const { decision } = await postExpenseItemJournal(item.id);

  await prisma.expenseReport.update({
    where: { id: expenseReportId },
    data: {
      submittedAt: report.submittedAt ?? new Date(),
      totalAmount: { increment: amount },
    },
  });

  const updatedItem = await prisma.expenseItem.findUnique({
    where: { id: item.id },
    include: { account: true, vendor: true, aiExtraction: true, journalEntry: { include: { lines: { include: { account: true } } } } },
  });

  return NextResponse.json({ item: updatedItem, decision }, { status: 201 });
}
