import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftContract } from "@/lib/contractDrafts";

// 契約書のひな形(秘密保持・業務委託・取引基本)とチェック。{ kind, counterparty, ..., useAi }。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftContract(user, body));
}
