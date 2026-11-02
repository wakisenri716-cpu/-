import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { mySupplyRequests, requestSupplies, requestSupply, splitSupplyWithAi } from "@/lib/supplyRequests";

// 自分の購入依頼
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ requests: await mySupplyRequests(user) }));
}

// 頼む: { text, note }(「コピー用紙 A4 5箱 至急」)か { items: [...], note }。{ preview: true } なら分けるだけ(AIが使えればAIで)
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.preview === true) return respond(() => splitSupplyWithAi(user, String(body.text ?? "")));
  if (Array.isArray(body.items)) return respond(async () => ({ requests: await requestSupplies(user, body, request) }), 201);
  return respond(async () => ({ request: await requestSupply(user, body, request) }), 201);
}
