import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { explainAnalysis } from "@/lib/analysisExplain";

// 経営分析の解説(AIが使えないときは決まったルールの解説)。{ from, to }。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => explainAnalysis(user, { from: body.from, to: body.to }));
}
