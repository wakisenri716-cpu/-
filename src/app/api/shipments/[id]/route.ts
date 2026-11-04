import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteShipment } from "@/lib/shipments";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteShipment({ companyId, role: user.role }, id);
    return { ok: true };
  });
}
