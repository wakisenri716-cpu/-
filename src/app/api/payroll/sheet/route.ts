import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getPayrollSheet, listStaffPayroll } from "@/lib/payroll/service";

// 給与計算表(控除・差引支給額)と、スタッフごとの控除の設定
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return respond(async () => ({ ...(await getPayrollSheet(companyId, month)), staff: await listStaffPayroll(companyId) }));
}
