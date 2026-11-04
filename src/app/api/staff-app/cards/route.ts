import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftEnglish, myCards, requestCard } from "@/lib/cardOrders";

// 前の注文の中身と、自分の注文
export async function GET() {
  const user = await requireMember();
  return respond(() => myCards(user));
}

// { action: "english", nameKana, title, department, useAi } で裏面の英語の案、それ以外は申し込む
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "english") return respond(() => draftEnglish(user, body));
  return respond(async () => ({ order: await requestCard(user, body) }), 201);
}
