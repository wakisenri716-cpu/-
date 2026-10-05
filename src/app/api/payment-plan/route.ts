import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getPaymentPlan, reviewPaymentPlan } from "@/lib/paymentPlan";
import { audit } from "@/lib/audit";

const bufferOf = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

// ?buffer= 手元に残したい金額(省略するとふだんの支出の半月分)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const buffer = bufferOf(new URL(request.url).searchParams.get("buffer"));
  return respond(() => getPaymentPlan(companyId, buffer));
}

// AIに支払計画を見直してもらう { buffer }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const buffer = bufferOf(body.buffer);
    const note = await reviewPaymentPlan(user, buffer);
    await audit("支払計画(AI)", `${note.mode === "claude" ? "AI" : "決まったルール"}で見直し`);
    return getPaymentPlan(user.companyId, buffer);
  });
}
