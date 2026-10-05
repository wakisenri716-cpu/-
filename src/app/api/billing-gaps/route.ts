import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { dismissBillingGap, getBillingGaps, reviewBillingGaps } from "@/lib/billingGaps";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getBillingGaps(companyId));
}

// { action: "review" } AIに見てもらう / { action: "dismiss", key } 今月は請求しない・対応済み
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "dismiss") {
      await dismissBillingGap(user, String(body.key ?? ""));
      await audit("請求漏れのチェック", `対応済みにした: ${String(body.key ?? "").split(":")[0]}`);
      return getBillingGaps(user.companyId);
    }
    const note = await reviewBillingGaps(user);
    await audit("請求漏れのチェック(AI)", note.mode === "claude" ? "AI" : "決まったルール");
    return getBillingGaps(user.companyId);
  });
}
