import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { reviewClose, runCloseTask } from "@/lib/assistant/closeAssistant";
import { audit } from "@/lib/audit";

const TASK_LABELS: Record<string, string> = { recurring: "定期取引", allocations: "期間按分", depreciation: "減価償却", bank: "確信度の高い明細の確定" };

// { month, action: "run", task } まとめて実行 / { month, action: "review" } AIの見立て
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "review") {
      const review = await reviewClose(user, body.month);
      await audit("月次決算の見立て(AI)", `${review.month}(${review.mode === "claude" ? "AI" : "決まったルール"})`);
      return { review };
    }
    const result = await runCloseTask(companyId, body.month, body.task);
    await audit("月次決算の作業をまとめて実行", `${result.month} ${TASK_LABELS[String(body.task)] ?? ""} ${result.done}件${result.errors.length ? `(失敗 ${result.errors.length}件)` : ""}`);
    return result;
  });
}
