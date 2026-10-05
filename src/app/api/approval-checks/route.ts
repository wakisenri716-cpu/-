import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { runApprovalCheck } from "@/lib/assistant/approvalCheck";
import { audit } from "@/lib/audit";

// { type: "REQUEST" | "EXPENSE", id, ifMissing? } 承認前のAIチェックを作る(作り直す)
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const type = body.type === "EXPENSE" ? "EXPENSE" : "REQUEST";
    const { check, created } = await runApprovalCheck(user, type, String(body.id ?? ""), !!body.ifMissing);
    if (created) await audit("承認前のAIチェック", `${type === "EXPENSE" ? "経費精算" : "稟議・申請"} ${check.targetId}(${check.mode === "claude" ? "AI" : "決まったルール"})`);
    return { check };
  });
}
