import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { adviseVendors } from "@/lib/vendorInsights";
import { audit } from "@/lib/audit";

// 仕入先ごとの変化に、AIが次の動き方を提案する
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(async () => {
    const note = await adviseVendors(user);
    await audit("仕入先の見守り(AIの提案)", `${note.key}(${note.mode === "claude" ? "AI" : "決まったルール"})`);
    return { ok: true };
  });
}
