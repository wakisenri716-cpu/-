import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { checkText } from "@/lib/textCheck";

// 送る前の文章チェック(何も保存しない)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => checkText({ id: user.id, companyId }, body ?? {}));
}
