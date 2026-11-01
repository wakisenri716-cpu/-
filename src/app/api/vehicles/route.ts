import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listVehicles } from "@/lib/vehicles";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ vehicles: await listVehicles(companyId) }));
}
