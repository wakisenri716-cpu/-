import { requireCompanyId } from "@/lib/auth/session";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { getBankTransactions } from "@/lib/bank/process";
import { respond } from "@/lib/shifts/http";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  await ensureChartOfAccounts(companyId);
  const account = new URL(request.url).searchParams.get("account");
  return respond(() => getBankTransactions(companyId, account));
}
