import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { InvoiceError, parseLines } from "@/lib/accounting/issueInvoice";
import { createQuote, listQuotes } from "@/lib/accounting/quotes";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listQuotes(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const quote = await createQuote(companyId, {
      customerName: String(body.customerName ?? ""),
      issueDate: String(body.issueDate ?? ""),
      validUntil: String(body.validUntil ?? ""),
      notes: body.notes ? String(body.notes) : null,
      lines: parseLines(body.lines),
    });
    return NextResponse.json(quote, { status: 201 });
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
