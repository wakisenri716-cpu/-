import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createBankAccount, KIND_LABELS, listBankAccounts } from "@/lib/bank/accounts";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listBankAccounts(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const created = await createBankAccount(companyId, body);
    await audit("口座・カードを追加", `${KIND_LABELS[created.kind as keyof typeof KIND_LABELS]} ${created.name}`);
    return created;
  }, 201);
}
