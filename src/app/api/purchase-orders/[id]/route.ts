import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { cancelPurchaseOrder, getPurchaseOrder, receivePurchaseOrder, undoReceive } from "@/lib/accounting/purchaseOrders";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 検収(receive)・検収の取消(undo)・発注の取消(cancel)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "receive") {
      const { order, invoice } = await receivePurchaseOrder(companyId, id, {
        receivedDate: String(body.receivedDate ?? ""),
        dueDate: String(body.dueDate ?? ""),
        accountCode: String(body.accountCode ?? ""),
        vendorInvoiceNumber: body.vendorInvoiceNumber ? String(body.vendorInvoiceNumber) : null,
      });
      await audit("発注書を検収", `${order.orderNumber} ${order.vendor.name} ${yen(invoice.totalAmount)}`);
      return NextResponse.json({ ok: true, invoiceId: invoice.id });
    }
    if (body.action === "undo") {
      const order = await undoReceive(companyId, id);
      await audit("発注書の検収を取消", `${order.orderNumber} ${order.vendor.name}`);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "cancel") {
      await cancelPurchaseOrder(companyId, id);
      const data = await getPurchaseOrder(companyId, id);
      await audit("発注書を取消", data?.order.orderNumber ?? id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "操作を指定してください" }, { status: 400 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
