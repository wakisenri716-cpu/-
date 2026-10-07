import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftGreeting } from "@/lib/greetingLetters";

// 挨拶状・お礼状の下書き(ひな形、または AI で本文を書き直す)。何も保存しない
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(() => draftGreeting(user, body));
}
