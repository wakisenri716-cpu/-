import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { adviseEntertainment } from "@/lib/entertainment";

// 交際費の見立て(AIが使えないときは決まったルール)。何も保存しない
export async function POST() {
  await requireCompanyId();
  const user = await requireMember();
  return respond(() => adviseEntertainment(user));
}
