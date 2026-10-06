import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftBudget } from "@/lib/budgetDraft";

// 予算の下書き(保存はしない。画面の入力欄に入れるだけ)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftBudget(user, body));
}
