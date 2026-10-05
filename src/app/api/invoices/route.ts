import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fileToBase64 } from "@/lib/fileToDataUri";
import { createInvoiceFromUpload } from "@/lib/accounting/invoiceUpload";
import { UserError } from "@/lib/errors";
import { requireCompanyId } from "@/lib/auth/session";
import type { InvoiceDirection } from "@prisma/client";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const { searchParams } = new URL(request.url);
  const direction = searchParams.get("direction") as InvoiceDirection | null;

  const invoices = await prisma.invoice.findMany({
    where: { companyId, ...(direction ? { direction } : {}) },
    include: { vendor: true, customer: true, aiExtraction: true, journalEntry: true, payments: true, _count: { select: { lines: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(invoices);
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
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
  try {
    const { invoice, decision } = await createInvoiceFromUpload(companyId, direction, base64, mediaType);
    return NextResponse.json({ invoice, decision }, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
