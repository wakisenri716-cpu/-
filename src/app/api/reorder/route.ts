import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createReorderPurchaseOrders, getReorderSuggestions, reorderOptions, reviewReorder } from "@/lib/reorder";
import { audit } from "@/lib/audit";

// 発注の提案(?lead=納品までの日数&cover=次の発注までの日数)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const p = new URL(request.url).searchParams;
  return respond(() => getReorderSuggestions(companyId, reorderOptions({ leadDays: p.get("lead"), coverDays: p.get("cover") })));
}

// { action: "review" } AIの見立て / { action: "order", items, deliveryDate } 選んだ商品で発注書を作る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "order") {
      const created = await createReorderPurchaseOrders(companyId, body);
      await audit("発注の提案から発注書を作成", created.map((c) => `${c.orderNumber} ${c.vendor}`).join(" / "));
      return { created };
    }
    return reviewReorder(user, reorderOptions(body));
  });
}
