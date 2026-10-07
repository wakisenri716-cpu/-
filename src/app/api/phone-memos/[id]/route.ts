import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteMemo, updateMemo } from "@/lib/phoneMemos";

// 対応済み・未対応に戻す
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({ memo: await updateMemo(companyId, id, body ?? {}) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(async () => {
    await deleteMemo(companyId, id);
    return { ok: true };
  });
}
