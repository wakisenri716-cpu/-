import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listSupplyRequests, orderSupplies } from "@/lib/supplyRequests";
import { audit, yen } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listSupplyRequests(companyId));
}

// まとめて発注書を作る: { vendorName, deliveryDate, items: [{ requestIds, description, quantity, unit, unitPrice, taxRate }] }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const r = await orderSupplies(user, body);
    await audit("購入依頼から発注書を作成", `${r.order.orderNumber} ${yen(r.order.totalAmount)}(依頼${r.count}件)`);
    return r;
  }, 201);
}
