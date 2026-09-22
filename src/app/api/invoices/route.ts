import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAiProvider } from "@/lib/ai";
import { fileToBase64, toDataUri } from "@/lib/fileToDataUri";
import { findOrCreateVendor, findOrCreateCustomer } from "@/lib/accounting/parties";
import { postInvoiceJournal } from "@/lib/accounting/automation";
import { getDefaultCompanyId } from "@/lib/demo";
import type { InvoiceDirection } from "@prisma/client";

export async function GET(request: Request) {
  const companyId = await getDefaultCompanyId();
  const { searchParams } = new URL(request.url);
  const direction = searchParams.get("direction") as InvoiceDirection | null;

  const invoices = await prisma.invoice.findMany({
    where: { companyId, ...(direction ? { direction } : {}) },
    include: { vendor: true, customer: true, aiExtraction: true, journalEntry: true, payments: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(invoices);
}

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const formData = await request.formData();

  const direction = formData.get("direction") as InvoiceDirection | null;
  if (direction !== "ISSUED" && direction !== "RECEIVED") {
    return NextResponse.json({ error: "direction must be ISSUED or RECEIVED" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const { base64, mediaType } = await fileToBase64(file);
  const extraction = await getAiProvider().extractInvoice({ imageBase64: base64, mediaType, direction });

  const subtotalAmount = extraction.subtotalAmount ?? 0;
  const taxAmount = extraction.taxAmount ?? 0;
  const totalAmount = extraction.totalAmount ?? subtotalAmount + taxAmount;
  if (totalAmount <= 0) {
    return NextResponse.json({ error: "Could not determine invoice amounts" }, { status: 422 });
  }

  const vendor =
    direction === "RECEIVED" && extraction.counterpartyName
      ? await findOrCreateVendor(companyId, extraction.counterpartyName)
      : null;
  const customer =
    direction === "ISSUED" && extraction.counterpartyName
      ? await findOrCreateCustomer(companyId, extraction.counterpartyName)
      : null;

  // A vendor's own default account (set on /vendors) is a stronger signal
  // than the AI's per-invoice guess, so it takes precedence when set.
  if (direction === "RECEIVED" && vendor?.defaultExpenseAccountId) {
    const defaultAccount = await prisma.account.findUnique({ where: { id: vendor.defaultExpenseAccountId } });
    if (defaultAccount) {
      extraction.suggestedAccountCode = defaultAccount.code;
      extraction.notes = [extraction.notes, `取引先の既定科目(${defaultAccount.code} ${defaultAccount.name})を適用しました。`]
        .filter(Boolean)
        .join(" ");
    }
  }

  const aiExtraction = await prisma.aiExtraction.create({
    data: {
      companyId,
      sourceType: "INVOICE",
      rawResponse: extraction,
      confidence: extraction.confidence,
      suggestedAccountCode: extraction.suggestedAccountCode,
      status: "NEEDS_REVIEW",
    },
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

  const updatedInvoice = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    include: {
      vendor: true,
      customer: true,
      aiExtraction: true,
      journalEntry: { include: { lines: { include: { account: true } } } },
    },
  });

  return NextResponse.json({ invoice: updatedInvoice, decision }, { status: 201 });
}
