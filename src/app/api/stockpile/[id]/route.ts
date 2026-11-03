import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteStock, saveStock } from "@/lib/stockpile";

// 直す(入れかえたときの新しい期限・数など)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ item: await saveStock({ companyId, name: user.name, role: user.role }, body, id) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteStock({ companyId, role: user.role }, id);
    return { ok: true };
  });
}
