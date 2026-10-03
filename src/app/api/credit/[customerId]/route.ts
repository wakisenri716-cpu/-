import { requireCompanyId } from "@/lib/auth/session";
import { updateCredit } from "@/lib/accounting/credit";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";

// 与信限度額・見直した日・メモを変える
export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const c = await updateCredit(companyId, customerId, body);
    await audit("与信限度額を変更", `${c.name} ${c.creditLimit === null ? "上限なし" : yen(c.creditLimit)}`);
    return { id: c.id, creditLimit: c.creditLimit };
  });
}
