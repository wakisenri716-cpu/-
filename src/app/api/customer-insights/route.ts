import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { adviseCustomers } from "@/lib/customerInsights";
import { audit } from "@/lib/audit";

// 顧客ごとの変化に、AIが次の動き方を提案する
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(async () => {
    const note = await adviseCustomers(user);
    await audit("顧客の見守り(AIの提案)", `${note.key}(${note.mode === "claude" ? "AI" : "決まったルール"})`);
    return { ok: true };
  });
}
