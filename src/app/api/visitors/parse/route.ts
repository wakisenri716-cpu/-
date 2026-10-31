import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { parseVisitor } from "@/lib/visitors";

// 1行の来客の予定を分ける(保存しない): { text }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({ draft: await parseVisitor(companyId, String(body?.text ?? "")) }));
}
