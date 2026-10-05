import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftQuote } from "@/lib/quoteAssist";

// { customerName, text } 文章から見積書の明細の下書きを作る
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftQuote(user, body));
}
