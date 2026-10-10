import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { bookingWarnings, parseBooking } from "@/lib/bookings";

// 1行の予約の文を読む(保存しない): { text }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const draft = await parseBooking(companyId, String(body?.text ?? ""));
    return { draft, warnings: await bookingWarnings(companyId, draft.date) };
  });
}
