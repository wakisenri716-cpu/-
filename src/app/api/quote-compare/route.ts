import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { compareVendorQuotes } from "@/lib/quoteCompare";

// 相見積の比較(保存しない): { quotes: [{ vendor, text }], useAi }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => compareVendorQuotes({ id: user.id, companyId }, body ?? {}));
}
