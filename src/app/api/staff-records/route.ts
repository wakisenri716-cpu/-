import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getStaffRecords } from "@/lib/staffRecords";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getStaffRecords(companyId));
}
