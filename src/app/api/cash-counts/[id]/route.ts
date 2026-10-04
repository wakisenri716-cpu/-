import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteCashCount } from "@/lib/accounting/cashCount";
import { audit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const r = await deleteCashCount(companyId, id);
    await audit("現金の実査の記録を削除", `${r.counted.toLocaleString()}円`);
    return { ok: true };
  });
}
