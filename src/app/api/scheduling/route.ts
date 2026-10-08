import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftScheduling } from "@/lib/scheduling";

// 日程のご相談メールの下書き(保存しない)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() =>
    draftScheduling({ id: user.id, companyId, name: user.name }, body ?? {}),
  );
}
