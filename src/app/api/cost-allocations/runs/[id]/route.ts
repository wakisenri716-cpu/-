import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { undoCostAllocation } from "@/lib/accounting/costAllocation";
import { audit } from "@/lib/audit";

// 配賦の取消(仕訳を取消にする)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const run = await undoCostAllocation(companyId, id);
    await audit("部門配賦を取消", `${run.allocation.name} ${run.month}`);
    return { ok: true };
  });
}
