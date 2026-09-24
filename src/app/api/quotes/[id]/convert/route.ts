import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { InvoiceError } from "@/lib/accounting/issueInvoice";
import { convertQuoteToInvoice } from "@/lib/accounting/quotes";
import { audit, yen } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const invoice = await convertQuoteToInvoice(companyId, id, { issueDate: String(body.issueDate ?? ""), dueDate: String(body.dueDate ?? "") });
    await audit("見積書を請求書に変換", `${invoice.invoiceNumber} ${yen(invoice.totalAmount)}`);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
