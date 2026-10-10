import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";
import { jstDateKey } from "@/lib/jst";
import { createBooking, listBookings } from "@/lib/bookings";

// 予約の一覧: ?from=YYYY-MM-DD&days=7
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  await requireMember();
  const url = new URL(request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : jstDateKey(new Date());
  const days = Math.min(31, Math.max(1, Number(url.searchParams.get("days")) || 7));
  return respond(async () => ({ bookings: await listBookings(companyId, from, days) }));
}

// 予約する: { facilityId, date, start, end, title }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await createBooking({ id: user.id, companyId, name: user.name }, body ?? {});
    await audit("予約", `${r.booking.facility.name} ${r.booking.date} ${r.booking.start}〜${r.booking.end} ${r.booking.title}`);
    return r;
  });
}
