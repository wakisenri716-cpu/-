import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listStock, recordStaffMovement } from "@/lib/staffInventory";
import { audit } from "@/lib/audit";

export async function GET() {
  const user = await requireMember();
  return respond(() => listStock(user.companyId));
}

// 出庫・棚卸の記録: { productId, type: "ISSUE" | "STOCKTAKE", quantity, memo }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await recordStaffMovement(user.companyId, user, body);
    await audit(r.type === "ISSUE" ? "在庫を出庫(Clerkly従業員用)" : "在庫を棚卸(Clerkly従業員用)", `${r.product.name} ${r.type === "ISSUE" ? `${r.quantity}${r.product.unit}出庫` : `実数${r.quantity}${r.product.unit}`} → 在庫${r.product.quantityOnHand}${r.product.unit}`);
    return { quantity: r.product.quantityOnHand, unit: r.product.unit, name: r.product.name };
  }, 201);
}
