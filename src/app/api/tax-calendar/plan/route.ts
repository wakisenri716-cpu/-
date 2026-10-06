import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { planCalendar } from "@/lib/taxCalendar";

// 近い期限の段取り(AIが使えないときは決まったひな形)。何も保存しない
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(() => planCalendar(user));
}
