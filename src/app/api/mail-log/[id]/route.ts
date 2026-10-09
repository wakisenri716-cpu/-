import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteMailItem, updateMailItem } from "@/lib/mailItems";

// 渡した・まだに戻す: { status: "HANDED" | "WAITING", handedTo }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({ item: await updateMailItem(companyId, id, body ?? {}, user.name) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(async () => {
    await deleteMailItem(companyId, id);
    return { ok: true };
  });
}
