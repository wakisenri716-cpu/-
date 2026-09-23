import { getDefaultCompanyId } from "@/lib/demo";
import { updateStaff } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() =>
    updateStaff(companyId, id, {
      ...(body.hourlyWage !== undefined ? { hourlyWage: Number(body.hourlyWage) } : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    }),
  );
}
