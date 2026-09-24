import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { cancelIssuedInvoice, InvoiceError } from "@/lib/accounting/issueInvoice";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    return NextResponse.json(await cancelIssuedInvoice(companyId, id));
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
