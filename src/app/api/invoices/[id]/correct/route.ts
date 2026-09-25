import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { correctIssuedInvoice, parseLines } from "@/lib/accounting/issueInvoice";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 発行した請求書を訂正する(元の請求書は取消・訂正版を新しい番号で発行)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const invoice = await correctIssuedInvoice(companyId, id, {
      customerName: String(body.customerName ?? ""),
      issueDate: String(body.issueDate ?? ""),
      dueDate: String(body.dueDate ?? ""),
      notes: body.notes ? String(body.notes) : null,
      departmentId: body.departmentId ? String(body.departmentId) : null,
      lines: parseLines(body.lines),
      reason: body.reason ? String(body.reason) : null,
    });
    await audit("請求書を訂正", `${invoice.invoiceNumber} ${yen(invoice.totalAmount)}${invoice.correctionReason ? `(${invoice.correctionReason})` : ""}`);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
