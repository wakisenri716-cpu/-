import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { routeRequest } from "@/lib/staffRouter";

// 総務に頼む: { text, useAi } → どの画面で頼めばよいか
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => routeRequest(user, body));
}
