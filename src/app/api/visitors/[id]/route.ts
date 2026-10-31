import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateVisitor } from "@/lib/visitors";

// お見えになった・お帰りになった・予定に戻す・取り消し: { status: "ARRIVED" | "LEFT" | "EXPECTED" | "CANCELLED", notify }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(() => updateVisitor({ id: user.id, companyId, name: user.name }, id, body ?? {}, request));
}
