import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { cancelIssuedInvoice, InvoiceError } from "@/lib/accounting/issueInvoice";
import { audit, yen } from "@/lib/audit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    const invoice = await cancelIssuedInvoice(companyId, id);
    await audit("請求書を取消", `${invoice.invoiceNumber} ${yen(invoice.totalAmount)}`);
    return NextResponse.json(invoice);
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
