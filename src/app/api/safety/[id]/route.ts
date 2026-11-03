import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateCheck } from "@/lib/safetyChecks";

// { action: "close" | "remind" | "summary", useAi }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => updateCheck({ id: user.id, name: user.name, companyId, role: user.role }, id, body, request));
}
