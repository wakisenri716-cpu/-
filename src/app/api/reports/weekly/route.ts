import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { buildWeekly } from "@/lib/weeklyReport";

// 週報を作る(保存はしない): { week: 週のどこかの日 YYYY-MM-DD, useAi }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () =>
    buildWeekly({ id: user.id, companyId }, body ?? {}),
  );
}
