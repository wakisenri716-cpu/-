import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getReceiptForecast, reviewReceiptForecast } from "@/lib/receiptForecast";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getReceiptForecast(companyId));
}

// AIに入金予測を見直してもらう
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(async () => {
    const note = await reviewReceiptForecast(user);
    await audit("入金予測(AI)", `遅めに見る請求書 ${Object.keys((note.data as { adjustments: object }).adjustments).length}件(${note.mode === "claude" ? "AI" : "決まったルール"})`);
    return getReceiptForecast(user.companyId);
  });
}
