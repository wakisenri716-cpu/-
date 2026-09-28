import { requireCompanyId } from "@/lib/auth/session";
import { listYearEnd } from "@/lib/payroll/yearEnd";
import { respond } from "@/lib/shifts/http";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => listYearEnd(companyId, new URL(request.url).searchParams.get("year")));
}
