import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { parseTasks } from "@/lib/teamTasks";

// 文章をやること・担当・期限に分ける(保存はしない)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () =>
    parseTasks({ id: user.id, companyId }, body ?? {}),
  );
}
