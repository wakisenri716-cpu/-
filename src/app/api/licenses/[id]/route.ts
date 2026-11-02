import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteLicense, saveLicense } from "@/lib/staffLicenses";

// 直す(更新したときの新しい期限・確かめた日など)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ license: await saveLicense({ companyId, name: user.name, role: user.role }, body, id) }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    await deleteLicense({ companyId, role: user.role }, id);
    return { ok: true };
  });
}
