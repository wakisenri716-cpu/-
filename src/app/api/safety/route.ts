import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftMessage, listChecks, startCheck } from "@/lib/safetyChecks";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ checks: await listChecks(companyId) }));
}

// { action: "draft", situation, useAi } で知らせる文を作る、それ以外は安否確認を始める(全員にメールとアプリの通知)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "draft") return respond(() => draftMessage(me, body));
  return respond(async () => {
    const r = await startCheck(me, body, request);
    await audit("安否確認を始めた", `${r.check.title}(${r.people}人・メール${r.sent}通)`);
    return r;
  }, 201);
}
