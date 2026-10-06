import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listRecentProposals } from "@/lib/assistant/proposals";

// AIからの下書き(確かめ待ちと、最近決めたもの)
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listRecentProposals(companyId));
}
