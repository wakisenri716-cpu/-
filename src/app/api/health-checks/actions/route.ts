import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftReminder, postHealthCosts, reminderTargets, sendReminders } from "@/lib/healthCheckActions";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// { action: "post" } 費用を仕訳 / "targets" 送る相手 / "draft" お知らせの文(useAi) / "send" 送る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "post")
    return respond(async () => {
      const r = await postHealthCosts(me, body);
      await audit("健康診断の費用を仕訳", `${r.count}件 ${r.total.toLocaleString()}円(福利厚生費)`);
      return r;
    });
  if (body.action === "targets") return respond(async () => ({ targets: await reminderTargets(companyId, body.kind === "FOLLOWUP" ? "FOLLOWUP" : "CHECKUP") }));
  if (body.action === "draft") return respond(() => draftReminder(me, body));
  if (body.action === "send")
    return respond(async () => {
      const r = await sendReminders(me, body);
      await audit("健康診断のお知らせを送信", `${body.kind === "FOLLOWUP" ? "再検査" : "受診"} ${r.sent}人`);
      return r;
    });
  return respond(async () => {
    throw new UserError("することがわかりません");
  });
}
