import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createTasks, listTasks } from "@/lib/teamTasks";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  await requireMember();
  return respond(async () => ({ tasks: await listTasks(companyId) }));
}

// やることを登録する: { tasks: [{ title, ownerUserId, due, partyKind, partyId }], notify }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await createTasks(
      { id: user.id, companyId, name: user.name },
      { ...(body ?? {}), source: "MANUAL", sourceId: null },
      request,
    );
    await audit("やることを登録", `${result.tasks.length}件`);
    return result;
  });
}
