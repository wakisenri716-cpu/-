import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateLeaveSettings } from "@/lib/leave/service";
import { audit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await updateLeaveSettings(companyId, id, body);
    await audit("有給休暇の設定を変更", id);
    return result;
  });
}
