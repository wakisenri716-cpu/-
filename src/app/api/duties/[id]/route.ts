import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteDuty, saveDuty, swapDuty } from "@/lib/duties";

// { action: "swap", date, userId } でその日だけ入れかえ、それ以外は当番を直す
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "swap") return respond(() => swapDuty(me, id, body));
  return respond(async () => ({ role: await saveDuty(me, body, id) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteDuty({ id: user.id, name: user.name, companyId, role: user.role }, id);
    return { ok: true };
  });
}
