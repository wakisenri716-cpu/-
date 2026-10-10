import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";
import { listFacilities, removeFacility, saveFacility } from "@/lib/bookings";

export async function GET() {
  const companyId = await requireCompanyId();
  await requireMember();
  return respond(async () => ({ facilities: await listFacilities(companyId) }));
}

// 予約できるものを足す・直す: { name, kind, note }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const f = await saveFacility({ companyId, role: user.role }, body ?? {});
    await audit("予約できるものを登録", f.name);
    return { facility: f, facilities: await listFacilities(companyId) };
  });
}

// 外す: { id }
export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    await removeFacility({ companyId, role: user.role }, String(body?.id ?? ""));
    return { facilities: await listFacilities(companyId) };
  });
}
