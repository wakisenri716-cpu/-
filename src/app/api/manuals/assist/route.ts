import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { assistManual } from "@/lib/manualAssist";

// マニュアルのAI手伝い(メモから下書き・やさしい日本語・英語版・チェック)。{ mode, title, notes | body, useAi }。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => assistManual(user, body));
}
