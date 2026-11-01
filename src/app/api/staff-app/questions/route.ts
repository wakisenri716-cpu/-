import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { askQuestion, myQuestions } from "@/lib/staffQuestions";

// 自分が総務に聞いた質問と答え
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ questions: await myQuestions(user) }));
}

// 総務に聞く: { question, aiReply }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({ question: await askQuestion(user, body ?? {}, request) }), 201);
}
