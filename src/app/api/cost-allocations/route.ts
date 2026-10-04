import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createCostAllocation, listCostAllocations } from "@/lib/accounting/costAllocation";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listCostAllocations(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const a = await createCostAllocation(companyId, body);
    await audit("部門配賦の設定を作成", a.name);
    return a;
  }, 201);
}
