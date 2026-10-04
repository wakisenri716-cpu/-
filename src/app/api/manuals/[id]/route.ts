import { getCurrentUser, requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteManual, updateManual } from "@/lib/manuals";
import { audit } from "@/lib/audit";
import { notifyManual } from "@/lib/push/events";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const { manual: m, wasPublished } = await updateManual(companyId, id, body);
    await audit("マニュアルを変更", m.title);
    // 下書きから公開にしたら「新しい」、公開中のものを直したら「更新」(更新の知らせは notify を付けたときだけ)
    if (!wasPublished) notifyManual(companyId, (await getCurrentUser())?.id, m, "new");
    else if (body.notify) notifyManual(companyId, (await getCurrentUser())?.id, m, "updated");
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
