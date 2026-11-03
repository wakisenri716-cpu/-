import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { answerSurvey, mySurveys } from "@/lib/surveys";

// 受付中のアンケートと自分の答え
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ surveys: await mySurveys(user) }));
}

// 答える: { surveyId, answers: { [questionId]: 値 } }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ response: await answerSurvey(user, String(body.surveyId ?? ""), body) }));
}
