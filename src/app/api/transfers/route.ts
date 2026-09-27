import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getTransferOverview } from "@/lib/transfers/service";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getTransferOverview(companyId));
}
