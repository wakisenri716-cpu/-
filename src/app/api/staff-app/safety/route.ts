import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { answerCheck, myChecks } from "@/lib/safetyChecks";

// 締めていない安否確認と自分の答え
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ checks: await myChecks(user) }));
}

// 答える: { checkId, status, canWork, note }
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(async () => ({ answer: await answerCheck(user, String(body.checkId ?? ""), body) }));
}
