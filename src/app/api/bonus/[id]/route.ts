import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { voidBonus } from "@/lib/payroll/bonus";
import { audit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const run = await voidBonus(companyId, id);
    await audit("賞与の計上を取消", run.label);
  });
}
