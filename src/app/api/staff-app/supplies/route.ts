import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { mySupplyRequests, parseSupplyText, requestSupply } from "@/lib/supplyRequests";

// 自分の購入依頼
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ requests: await mySupplyRequests(user) }));
}

// 頼む: { text, note }(「コピー用紙 A4 5箱 至急」)。{ preview: true } なら分けるだけ
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.preview === true) return respond(async () => ({ parsed: parseSupplyText(String(body.text ?? "")) }));
  return respond(async () => ({ request: await requestSupply(user, body, request) }), 201);
}
