import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteGrant } from "@/lib/leave/service";
import { audit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const removed = await deleteGrant(companyId, id);
    await audit("有給休暇の付与を削除", `${removed.grantDate.toISOString().slice(0, 10)} ${removed.halfDays / 2}日`);
  });
}
