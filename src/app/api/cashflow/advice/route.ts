import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { generateCashAdvice } from "@/lib/assistant/cashAdvice";
import { audit } from "@/lib/audit";

// 今日の資金繰りアドバイスを作る(作り直す)
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(async () => {
    const advice = await generateCashAdvice(user);
    await audit("AIの資金繰りアドバイスを作成", `${advice.date}(${advice.mode === "claude" ? "AI" : "決まったルール"})`);
    return { advice };
  });
}
