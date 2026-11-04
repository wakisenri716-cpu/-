import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { askSwap } from "@/lib/duties";

// 自分の当番を代わってもらうよう頼む: { roleId, date, toUserId, message }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ request: await askSwap(user, body) }), 201);
}
