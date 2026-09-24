import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { issueRecurringInvoice } from "@/lib/accounting/recurringInvoices";
import { UserError } from "@/lib/errors";
import { audit, yen } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const invoice = await issueRecurringInvoice(companyId, id, String(body.month ?? ""));
    await audit("定期請求から請求書を作成", `${invoice.invoiceNumber} ${yen(invoice.totalAmount)}`);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
