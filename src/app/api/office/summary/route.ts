import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { officeFacts, officeSummary } from "@/lib/officeToday";

// 総務のきょうのまとめ(AIが使えればAIで)
export async function POST() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  return respond(async () => officeSummary({ id: user.id, companyId }, await officeFacts(companyId), true));
}
