import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";
import { orderFromQuote } from "@/lib/quoteCompare";

// 選んだ見積から発注書を作る: { vendor, quote }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const order = await orderFromQuote({ companyId, role: user.role }, body ?? {});
    await audit("相見積から発注書を作成", `${order.orderNumber} ${yen(order.totalAmount)}`);
    return { id: order.id, orderNumber: order.orderNumber };
  }, 201);
}
