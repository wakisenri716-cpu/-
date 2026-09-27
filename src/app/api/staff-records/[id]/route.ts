import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateProfile } from "@/lib/staffRecords";
import { audit } from "@/lib/audit";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const name = await updateProfile(companyId, id, body);
    await audit("労働者名簿の情報を変更", name);
    return { ok: true };
  });
}
