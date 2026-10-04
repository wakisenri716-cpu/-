import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createForeignTransaction, formatForeign, listForeignTransactions } from "@/lib/accounting/foreign";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listForeignTransactions(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const t = await createForeignTransaction(companyId, body);
    await audit(t.kind === "SALE" ? "外貨建ての売上を計上" : "外貨建ての仕入を計上", `${t.partner} ${formatForeign(t.amountMinor, t.currency)} → ${t.jpyAmount.toLocaleString()}円`);
    // BigInt はそのまま JSON にできないので、必要なものだけ返す
    return { id: t.id, jpyAmount: t.jpyAmount };
  }, 201);
}
