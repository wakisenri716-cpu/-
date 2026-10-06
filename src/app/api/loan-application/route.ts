import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { buildLoanApplication } from "@/lib/loanApplication";

// 融資相談の資料を作る(保存はしない。画面で印刷・PDF保存する)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => buildLoanApplication(user, body));
}
