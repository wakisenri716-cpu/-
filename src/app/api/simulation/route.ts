import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { runSimulation } from "@/lib/simulation";

// もしもシミュレーション。{ text } なら文章を条件に直してから、{ scenario } ならその条件で計算する(何も保存しない)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => runSimulation(user, body));
}
