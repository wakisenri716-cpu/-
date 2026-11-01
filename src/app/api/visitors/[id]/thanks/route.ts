import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftThanks, sendThanks, visitorLabel } from "@/lib/visitors";
import { audit } from "@/lib/audit";

// お礼のメール: { send: false, useAi } で下書き、{ send: true, to, subject, body } で送る
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  const me = { id: user.id, companyId, name: user.name };
  if (body.send !== true) return respond(() => draftThanks(me, id, body.useAi === true));
  return respond(async () => {
    const visitor = await sendThanks(me, id, body);
    await audit("来客にお礼のメールを送信", `${visitorLabel(visitor)} ${String(body.to ?? "")}`);
    return { visitor };
  });
}
