import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftHandover } from "@/lib/handover";

// 引き継ぎメモを作る(保存しない): { fromUserId, toUserId, period, note, useAi }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftHandover({ id: user.id, companyId }, body ?? {}));
}
