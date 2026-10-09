import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftNegotiation } from "@/lib/quoteCompare";

// 値下げの相談メールの下書き(保存しない): { vendor, points, totalGap, note, useAi }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftNegotiation({ id: user.id, companyId, name: user.name }, body ?? {}));
}
