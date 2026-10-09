import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";
import { closureTasks, shiftClosureTasks } from "@/lib/companyClosures";

// お休み中が期限のやること: GET ?date=休業のはじめの日
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const date = new URL(request.url).searchParams.get("date");
  return respond(() => closureTasks(companyId, date));
}

// お休みの前の営業日に前倒しする: { date }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await shiftClosureTasks(user, body ?? {});
    await audit("お休み中が期限のやることを前倒し", `${result.notice.name} ${result.count}件 → ${result.before}`);
    return result;
  });
}
