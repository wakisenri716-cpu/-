import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listLost, parseLost, registerLost, searchLost } from "@/lib/lostItems";

// みんなの落とし物の一覧
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ items: await listLost(user.companyId) }));
}

// { action: "parse", text } / { action: "search", query, useAi } / それ以外は見つけたものを登録
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseLost(String(body.text ?? "")) }));
  if (body.action === "search") return respond(() => searchLost(user, body));
  return respond(async () => ({ item: await registerLost(user, body) }), 201);
}
