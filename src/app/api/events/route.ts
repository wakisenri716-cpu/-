import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { jstDateKey } from "@/lib/jst";
import { createEvent, draftInvitation, listEvents, parseEventText } from "@/lib/companyEvents";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ events: await listEvents(companyId) }));
}

// { action: "parse", text } で1行を分ける、{ action: "draft", ...項目, useAi } で案内の下書き、それ以外は作る(announce・notify・text)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ fields: parseEventText(String(body.text ?? ""), jstDateKey(new Date())) }));
  if (body.action === "draft") return respond(() => draftInvitation(user, body, body.useAi === true));
  return respond(async () => {
    const r = await createEvent(user, body, request);
    await audit("社内イベントを作成", `${r.event.date} ${r.event.title}${r.announced ? "(お知らせに掲載)" : ""}`);
    return r;
  }, 201);
}
