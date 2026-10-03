import { requireCompanyId } from "@/lib/auth/session";
import { checkCredit } from "@/lib/accounting/credit";
import { respond } from "@/lib/shifts/http";

// 請求書を作る前の確認: ?customer=顧客名&amount=税込金額
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const params = new URL(request.url).searchParams;
  return respond(async () => (await checkCredit(companyId, params.get("customer") ?? "", Number(params.get("amount") ?? 0))) ?? { limit: null });
}
