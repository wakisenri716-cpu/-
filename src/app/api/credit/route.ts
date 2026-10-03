import { requireCompanyId } from "@/lib/auth/session";
import { listCredit } from "@/lib/accounting/credit";
import { respond } from "@/lib/shifts/http";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listCredit(companyId));
}
