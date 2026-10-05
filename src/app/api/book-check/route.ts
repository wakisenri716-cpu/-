import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { reviewBooks } from "@/lib/bookCheck";
import { audit } from "@/lib/audit";

// AIに、点検で見つかったところをどこから直すかまとめてもらう
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(async () => {
    const review = await reviewBooks(user);
    await audit("帳簿の健康診断(AI)", `${review.period}〜 ${review.score}点(${review.mode === "claude" ? "AI" : "決まったルール"})`);
    return { review };
  });
}
