import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftCelebration, sendCelebration, upcomingCelebrations } from "@/lib/celebrations";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ upcoming: await upcomingCelebrations(companyId) }));
}

// { action: "draft", staffId, kind, hint, useAi } で言葉の案 / "skip" で今年は見送り / それ以外は送る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "draft") return respond(() => draftCelebration(me, body));
  return respond(async () => {
    const r = await sendCelebration(me, body, request);
    await audit(body.action === "skip" ? "お祝いを見送り" : "お祝いを送った", `${body.kind === "ANNIVERSARY" ? "入社の記念日" : "誕生日"}`);
    return r;
  });
}
