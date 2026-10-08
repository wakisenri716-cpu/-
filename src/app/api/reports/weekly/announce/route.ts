import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { postWeekly } from "@/lib/weeklyReport";

// 週報を社内のお知らせに載せる: { week, body, notify }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => postWeekly(user, body ?? {}, request));
}
