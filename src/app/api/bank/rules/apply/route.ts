import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { applyRulesToPending } from "@/lib/bank/process";
import { audit } from "@/lib/audit";

// 確認待ちの明細に、いまのルールを当てはめる
export async function POST() {
  const companyId = await requireCompanyId();
  return respond(async () => {
    const r = await applyRulesToPending(companyId);
    if (r.matched) await audit("自動仕訳ルールを確認待ちの明細に適用", `記帳 ${r.posted}件・提案 ${r.suggested}件`);
    return r;
  });
}
