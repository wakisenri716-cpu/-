import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { answerEvent, myEvents } from "@/lib/companyEvents";

// これからの社内のイベントと自分の出欠
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ events: await myEvents(user) }));
}

// 出欠を答える: { eventId, answer: "YES" | "NO" | "MAYBE", comment }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ answer: await answerEvent(user, String(body.eventId ?? ""), body) }));
}
