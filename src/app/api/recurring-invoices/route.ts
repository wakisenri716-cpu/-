import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { createRecurringInvoice, listRecurringInvoices } from "@/lib/accounting/recurringInvoices";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  const [items, templates] = await Promise.all([
    listRecurringInvoices(companyId),
    // ひな形にできるのは、この画面で作成した(明細のある)発行請求書
    prisma.invoice.findMany({
      where: { companyId, direction: "ISSUED", lines: { some: {} } },
      select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, customer: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take: 100,
    }),
  ]);
  return NextResponse.json({ items, templates });
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const item = await createRecurringInvoice(companyId, {
      name: String(body.name ?? ""),
      templateInvoiceId: String(body.templateInvoiceId ?? ""),
      issueDay: Number(body.issueDay),
      dueDays: body.dueDays === null || body.dueDays === "" || body.dueDays === undefined ? null : Number(body.dueDays),
      startMonth: String(body.startMonth ?? ""),
      endMonth: body.endMonth ? String(body.endMonth) : null,
    });
    await audit("定期請求を登録", item.name);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
