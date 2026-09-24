import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { InvoiceError, issueInvoice } from "@/lib/accounting/issueInvoice";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  const lines = Array.isArray(body.lines) ? body.lines : [];
  try {
    const invoice = await issueInvoice(companyId, {
      customerName: String(body.customerName ?? ""),
      issueDate: String(body.issueDate ?? ""),
      dueDate: String(body.dueDate ?? ""),
      notes: body.notes ? String(body.notes) : null,
      lines: lines.map((l: Record<string, unknown>) => ({
        description: String(l.description ?? ""),
        quantity: Number(l.quantity),
        unit: l.unit ? String(l.unit) : null,
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
      })),
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
