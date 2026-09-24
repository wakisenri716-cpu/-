import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { InvoiceError } from "@/lib/accounting/issueInvoice";
import { cancelQuote } from "@/lib/accounting/quotes";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    await cancelQuote(companyId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
