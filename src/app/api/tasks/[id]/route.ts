import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteTask, updateTask } from "@/lib/teamTasks";

// 済み・未済に戻す・担当・期限・内容の変更
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({
    task: await updateTask({ companyId, name: user.name }, id, body ?? {}),
  }));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const companyId = await requireCompanyId();
  await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteTask(companyId, id);
    return { ok: true };
  });
}
