import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { InvoiceError } from "@/lib/accounting/issueInvoice";
import { cancelQuote } from "@/lib/accounting/quotes";
import { audit } from "@/lib/audit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    await cancelQuote(companyId, id);
    const quote = await prisma.quote.findFirst({ where: { id, companyId }, select: { quoteNumber: true } });
    await audit("見積書を取消", quote?.quoteNumber ?? id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
