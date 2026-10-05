import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { askAssistant } from "@/lib/assistant";

// { history: [{ role: "user" | "assistant", text }] } 最後の user の質問に答える
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => askAssistant(user, body.history));
}
