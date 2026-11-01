import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { answerQuestion, draftAnswer } from "@/lib/staffQuestions";
import { audit } from "@/lib/audit";

// { action: "draft", useAi } で答えの下書き、{ action: "answer", answer, saveFaq, faqTitle } で答える
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "draft") return respond(() => draftAnswer(user, id, body.useAi === true));
  return respond(async () => {
    const r = await answerQuestion(user, id, body, request);
    await audit("総務への質問に回答", `${r.question.userName}さん「${r.question.question.slice(0, 40)}」${r.question.manualId && body.saveFaq === true ? "(よくある質問に追加)" : ""}`);
    return r;
  });
}
