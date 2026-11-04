import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { answerSwap } from "@/lib/duties";

// { action: "accept" | "decline" | "cancel" }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ request: await answerSwap(user, id, body) }));
}
