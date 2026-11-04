import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listCards, updateCards } from "@/lib/cardOrders";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listCards(companyId));
}

// { action: "order", ids, to } 印刷会社にまとめて発注 / { action: "delivered", ids } 届いた
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => {
    const r = await updateCards({ id: user.id, name: user.name, companyId, role: user.role }, body);
    await audit(body.action === "order" ? "名刺を発注した" : "名刺が届いた", `${r.count}名分`);
    return r;
  });
}
