import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftGuide } from "@/lib/hrProcedures";

// 本人に送る入社・退職の案内文(ひな形、または AI)。{ staffId, notes, useAi }。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftGuide(user, body));
}
