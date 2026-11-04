import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateLost } from "@/lib/lostItems";

// 総務: { status: "RETURNED" | "DISPOSED" | "FOUND" }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => updateLost({ companyId, role: user.role }, id, body));
}
