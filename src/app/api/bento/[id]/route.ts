import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { UserError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { saveShop } from "@/lib/bento";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ shop: await saveShop({ id: user.id, name: user.name, companyId, role: user.role }, body, id) }));
}

// お店をやめる(これまでの注文は残す)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    if (user.role !== "ADMIN" && user.role !== "ACCOUNTANT") throw new UserError("お弁当のお店は管理者・経理担当が扱えます");
    const { count } = await prisma.bentoShop.updateMany({ where: { id, companyId }, data: { active: false } });
    if (!count) throw new UserError("見つかりません");
    return { ok: true };
  });
}
