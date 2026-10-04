import { requireCompanyId } from "@/lib/auth/session";
import { getPropertyTaxReport } from "@/lib/accounting/propertyTax";
import { respond } from "@/lib/shifts/http";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => getPropertyTaxReport(companyId, new URL(request.url).searchParams.get("year")));
}
