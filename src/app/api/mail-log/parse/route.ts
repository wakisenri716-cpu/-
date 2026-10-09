import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { parseMailText } from "@/lib/mailItems";

// メモを1件ずつに分ける(保存しない): { text, useAi }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => parseMailText({ id: user.id, companyId }, body ?? {}));
}
