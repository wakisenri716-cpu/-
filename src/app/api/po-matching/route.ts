import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { cancelImportedInvoice, linkInvoiceToOrder } from "@/lib/poMatching";
import { audit, yen } from "@/lib/audit";

// { action: "link", orderId, invoiceId } 取り込んだ請求書で発注書を検収済みにする
// { action: "cancel", invoiceId } 二重に取り込んだ請求書を取り消す
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "cancel") {
      const inv = await cancelImportedInvoice(companyId, String(body.invoiceId ?? ""));
      await audit("二重の請求書を取消", `${inv.invoiceNumber ?? ""} ${yen(inv.totalAmount)}`);
      return { ok: true };
    }
    const { order, invoice } = await linkInvoiceToOrder(companyId, String(body.orderId ?? ""), String(body.invoiceId ?? ""));
    await audit("請求書で発注書を検収", `${order.orderNumber} ← ${invoice.invoiceNumber ?? ""} ${yen(invoice.totalAmount)}`);
    return { ok: true };
  });
}
