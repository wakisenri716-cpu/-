import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myBento, orderBento } from "@/lib/bento";

// 今日(?date=)のお店・メニューと自分の注文
export async function GET(request: Request) {
  const user = await requireMember();
  return respond(() => myBento(user, new URL(request.url).searchParams.get("date") ?? undefined));
}

// 頼む・数を変える: { shopId, itemId, qty, date }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => orderBento(user, body));
}
