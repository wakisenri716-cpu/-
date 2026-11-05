import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myYearEndForm, submitYearEndForm } from "@/lib/yearEndForms";

// 従業員: 自分の年末調整の申告
export async function GET(request: Request) {
  const user = await requireMember();
  return respond(() => myYearEndForm(user, new URL(request.url).searchParams.get("year") ?? undefined));
}

export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  return respond(() => submitYearEndForm(user, body));
}
