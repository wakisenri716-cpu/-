import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getPayrollReview, reviewPayroll, runPayrollCheck } from "@/lib/payrollCheck";
import { audit } from "@/lib/audit";

// ?month=YYYY-MM 計上前のチェック(決まったルール)と、保存してあるAIの見立て
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return respond(async () => {
    const [check, review] = await Promise.all([runPayrollCheck(companyId, month), getPayrollReview(companyId, month)]);
    return { check, review };
  });
}

// { month } AIに計上してよいかを見立ててもらう
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const review = await reviewPayroll(user, String(body.month ?? ""));
    await audit("給料の計上前チェック(AI)", `${review.key}(${review.mode === "claude" ? "AI" : "決まったルール"})`);
    return { review };
  });
}
