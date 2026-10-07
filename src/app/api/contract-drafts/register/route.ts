import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { registerDraftToLedger } from "@/lib/contractDrafts";

// ひな形の条件で「契約書の台帳」に登録する(期限・更新の管理のため)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => registerDraftToLedger(user, body), 201);
}
