import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myHealth, saveOwnHealth } from "@/lib/healthChecks";

// 自分の健康診断
export async function GET() {
  const user = await requireMember();
  return respond(() => myHealth(user));
}

// 予約した・受けた・再検査を受けた を自分で入れる(結果の中身は入れない)
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ record: await saveOwnHealth(user, body) }), 201);
}
