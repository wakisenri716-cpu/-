import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { askStaffAssistant } from "@/lib/staffAssistant";

// 従業員向けのAIアシスタント { history: [{ role, text }] }(本人のこととマニュアル・お知らせだけに答える)
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => askStaffAssistant(user, body.history));
}
