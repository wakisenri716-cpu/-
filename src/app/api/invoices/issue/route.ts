import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { issueInvoice, parseLines } from "@/lib/accounting/issueInvoice";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const invoice = await issueInvoice(companyId, {
      customerName: String(body.customerName ?? ""),
      issueDate: String(body.issueDate ?? ""),
      dueDate: String(body.dueDate ?? ""),
      notes: body.notes ? String(body.notes) : null,
      lines: parseLines(body.lines),
    });
    await audit("請求書を作成", `${invoice.invoiceNumber} ${yen(invoice.totalAmount)}`);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
