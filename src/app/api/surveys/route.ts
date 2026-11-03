import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createSurvey, draftSurvey, listSurveys } from "@/lib/surveys";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ surveys: await listSurveys(companyId) }));
}

// { action: "draft", purpose, useAi } で質問の案、それ以外はアンケートを作って送る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "draft") return respond(() => draftSurvey(me, body));
  return respond(async () => {
    const r = await createSurvey(me, body, request);
    await audit("アンケートを送った", `${r.survey.title}(${r.people}人・メール${r.sent}通)`);
    return { id: r.survey.id, sent: r.sent, people: r.people };
  }, 201);
}
