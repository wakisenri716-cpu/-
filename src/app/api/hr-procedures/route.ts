import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getHrProcedures, setProcedureCheck } from "@/lib/hrProcedures";

// 入社・退職の手続きナビ(期限つきのチェックリスト)
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getHrProcedures(companyId));
}

// 手続きを「済み」にする / 戻す。{ staffId, key, done }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    await setProcedureCheck(user, body);
    return getHrProcedures(user.companyId);
  });
}
