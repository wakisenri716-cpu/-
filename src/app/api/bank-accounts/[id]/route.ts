import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { updateBankAccount } from "@/lib/bank/accounts";
import { audit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const updated = await updateBankAccount(companyId, id, body);
    await audit("口座・カードを変更", `${updated.name}${updated.active ? "" : "(しまう)"}`);
    return updated;
  });
}
