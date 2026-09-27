import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateLaborDefaults } from "@/lib/staffRecords";
import { audit } from "@/lib/audit";

export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const d = await updateLaborDefaults(companyId, body);
    await audit("労働条件の会社の決まりを変更", null);
    return d;
  });
}
