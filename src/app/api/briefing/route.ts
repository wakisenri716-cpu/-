import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { generateBriefing, getBriefing } from "@/lib/assistant/briefing";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";

// ?date=YYYY-MM-DD(省略すると今日)のブリーフィング
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const date = new URL(request.url).searchParams.get("date") || jstDateKey(new Date());
  return respond(async () => ({ briefing: await getBriefing(companyId, date) }));
}

// 今日のブリーフィングを作る。{ ifMissing: true } なら、もうあるときは作り直さずにそれを返す(ダッシュボードの自動作成用)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.ifMissing) {
      const existing = await getBriefing(companyId, jstDateKey(new Date()));
      if (existing) return { briefing: existing, created: false };
    }
    const briefing = await generateBriefing(companyId, user.id);
    await audit("AIの朝のブリーフィングを作成", `${briefing.date}(${briefing.mode === "claude" ? "AI" : "決まったルール"})`);
    return { briefing, created: true };
  });
}
