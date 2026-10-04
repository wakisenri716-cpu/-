import { getCurrentUser } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createTicket } from "@/lib/support";

// お問い合わせを受け付ける(ログインしていなくても送れる)
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    await createTicket(body, user);
    return { ok: true };
  }, 201);
}
