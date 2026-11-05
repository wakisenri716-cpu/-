import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteLending, extendLending, remindLending, returnLending } from "@/lib/lendings";

// { action: "remind" } 返却のお願いを送る / { action: "return" } 返してもらった / { action: "return", undo: true } 取り消す / { action: "extend", dueOn }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  const me = { companyId, role: user.role };
  if (body.action === "remind") return respond(async () => await remindLending({ companyId, name: user.name, role: user.role }, id));
  if (body.action === "extend") return respond(async () => ({ lending: await extendLending(me, id, String(body.dueOn ?? "")) }));
  return respond(async () => ({ lending: await returnLending(me, id, body) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteLending({ companyId, role: user.role }, id);
    return { ok: true };
  });
}
