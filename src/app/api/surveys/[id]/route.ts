import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { surveyResults, updateSurvey } from "@/lib/surveys";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(() => surveyResults(companyId, id));
}

// { action: "close" | "summary" }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => updateSurvey({ id: user.id, name: user.name, companyId, role: user.role }, id, body));
}
