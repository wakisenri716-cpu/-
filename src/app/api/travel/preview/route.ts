import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { previewTrip } from "@/lib/travel";

// 出張の日当・宿泊費の見込み(まだ記録しない)
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => previewTrip(user.companyId, body));
}
