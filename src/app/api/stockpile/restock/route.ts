import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { orderRestock, restockPlan } from "@/lib/stockpileRestock";
import { audit } from "@/lib/audit";

// 入れかえ・買い足しの候補(?people= で人数を入れかえ)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const people = Number(new URL(request.url).searchParams.get("people")) || undefined;
  return respond(() => restockPlan(companyId, people));
}

// 発注書を作る: { vendorName, deliveryDate, lines: [{ itemId?, description, quantity, unit, unitPrice, taxRate }] }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const r = await orderRestock({ companyId, name: user.name, role: user.role }, body);
    await audit("備蓄品の発注書を作成", `${r.order.orderNumber} ${r.count}品 ${r.order.totalAmount.toLocaleString()}円`);
    return r;
  }, 201);
}
