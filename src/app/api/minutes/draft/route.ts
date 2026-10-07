import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftMinutes } from "@/lib/minutes";

// 会議のメモを議事録の形に整える(保存はしない)。{ notes, title, heldOn, place, attendees, useAi }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftMinutes(user, body));
}
