import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { mySeals, parseSeal, requestSeal } from "@/lib/sealUses";

// 自分の押印の申請
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ seals: await mySeals(user) }));
}

// { action: "parse", text } で1行を分ける、それ以外は申請する
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseSeal(String(body.text ?? "")) }));
  return respond(async () => ({ seal: await requestSeal(user, body, request) }), 201);
}
