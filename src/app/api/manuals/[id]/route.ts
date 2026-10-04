import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteManual, updateManual } from "@/lib/manuals";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const m = await updateManual(companyId, id, body);
    await audit("マニュアルを変更", m.title);
    return m;
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const m = await deleteManual(companyId, id);
    await audit("マニュアルを削除", m.title);
    return { ok: true };
  });
}
