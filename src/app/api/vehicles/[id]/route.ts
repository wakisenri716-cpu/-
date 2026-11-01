import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listVehicles, saveVehicle } from "@/lib/vehicles";
import { audit } from "@/lib/audit";

// 社用車の情報を直す: { plate, inspectionDue, insuranceDue, serviceAtKm }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const car = await saveVehicle({ companyId, role: user.role }, id, body ?? {});
    await audit("社用車の情報を更新", `${car.name}${car.plate ? `(${car.plate})` : ""} 車検 ${car.inspectionDue ?? "-"} 保険 ${car.insuranceDue ?? "-"} 点検 ${car.serviceAtKm ?? "-"}km`);
    return { vehicles: await listVehicles(companyId) };
  });
}
