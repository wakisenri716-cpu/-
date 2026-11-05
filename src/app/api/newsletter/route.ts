import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftNewsletter, publishNewsletter } from "@/lib/newsletter";
import { audit } from "@/lib/audit";

// { action: "draft", month, note, birthdays, useAi } 下書き / { action: "publish", title, body, notify } お知らせに出す
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "publish")
    return respond(async () => {
      const r = await publishNewsletter(me, body, request);
      await audit("社内報を出した", String(body.title ?? "").slice(0, 100));
      return { id: r.announcement.id, mailed: r.mailed };
    }, 201);
  return respond(() => draftNewsletter(me, body));
}
