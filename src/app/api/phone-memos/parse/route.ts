import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { parseMemo } from "@/lib/phoneMemos";

// 走り書きを項目に分ける(保存はしない)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => parseMemo({ id: user.id, companyId }, body ?? {}));
}
