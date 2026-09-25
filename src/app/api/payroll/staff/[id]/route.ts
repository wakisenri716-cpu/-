import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateStaffPayroll } from "@/lib/payroll/service";
import { audit } from "@/lib/audit";

// スタッフの控除の設定(扶養・税区分・保険の加入・通勤手当・住民税)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const staff = await updateStaffPayroll(companyId, id, body);
    await audit("スタッフの給与設定を変更", staff.name);
    return staff;
  });
}
