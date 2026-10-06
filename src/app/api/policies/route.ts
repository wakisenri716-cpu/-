import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftPolicy } from "@/lib/policyDrafts";

// 社内規程の下書き(ひな形、または AIで会社に合わせたもの)。{ kind, inputs, effectiveDate, notes, useAi }。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftPolicy(user, body));
}
