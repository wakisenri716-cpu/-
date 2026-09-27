import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { parseLines } from "@/lib/accounting/issueInvoice";
import { createPurchaseOrder, listPurchaseOrders } from "@/lib/accounting/purchaseOrders";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listPurchaseOrders(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const order = await createPurchaseOrder(companyId, {
      // 入力画面は見積書・請求書と共通なので、相手の名前は customerName で届く
      vendorName: String(body.vendorName ?? body.customerName ?? ""),
      issueDate: String(body.issueDate ?? ""),
      deliveryDate: String(body.deliveryDate ?? body.dueDate ?? ""),
      deliveryPlace: body.deliveryPlace ? String(body.deliveryPlace) : null,
      paymentTerms: body.paymentTerms ? String(body.paymentTerms) : null,
      notes: body.notes ? String(body.notes) : null,
      lines: parseLines(body.lines),
    });
    await audit("発注書を作成", `${order.orderNumber} ${yen(order.totalAmount)}`);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
