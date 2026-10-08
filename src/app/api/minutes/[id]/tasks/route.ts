import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { tasksFromMinutes } from "@/lib/teamTasks";
import { audit } from "@/lib/audit";

// 議事録の「やること」をやることリストに入れる: { notify }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await tasksFromMinutes(
      { id: user.id, companyId, name: user.name },
      id,
      body?.notify === true,
      request,
    );
    if (result.tasks.length)
      await audit("議事録のやることを登録", `${result.tasks.length}件`);
    return result;
  });
}
