import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordInvoicePayment } from "@/lib/accounting/payments";
import { requireCompanyId } from "@/lib/auth/session";
import { audit, yen } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: invoiceId } = await params;
  const companyId = await requireCompanyId();
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice) {
    return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();

  try {
    const result = await recordInvoicePayment(invoiceId, amount, paymentDate);
    await audit("入金・支払を記録", `${invoice.invoiceNumber ?? "請求書"} ${yen(amount)}`);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to record payment" }, { status: 400 });
  }
}
