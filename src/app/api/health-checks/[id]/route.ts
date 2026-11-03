import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteHealth, saveHealth } from "@/lib/healthChecks";

// 直す(受けた日・再検査を受けた日など)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ record: await saveHealth({ companyId, name: user.name, role: user.role }, body, id) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteHealth({ companyId, role: user.role }, id);
    return { ok: true };
  });
}
