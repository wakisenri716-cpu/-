import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftJobPosting } from "@/lib/jobPosting";

// 求人票の下書き(ひな形、または AI で仕事内容・アピールを書き直す)とチェック。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftJobPosting(user, body));
}
