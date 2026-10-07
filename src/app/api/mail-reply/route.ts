import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftMailReply } from "@/lib/mailReply";

// 届いたメールへの返信の下書き(送らない)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => draftMailReply({ id: user.id, companyId, name: user.name }, body ?? {}));
}
