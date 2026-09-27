import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getLeaveOverview } from "@/lib/leave/service";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getLeaveOverview(companyId));
}
