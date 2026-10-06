import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getTaxCalendar, setCalendarCheck } from "@/lib/taxCalendar";

// 税金・労務の年間カレンダー(申告・届出・納付の期限)
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getTaxCalendar(companyId));
}

// 期限を「済み」にする / 戻す。{ key, done }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    await setCalendarCheck(user, body);
    return getTaxCalendar(user.companyId);
  });
}
