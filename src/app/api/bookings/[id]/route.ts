import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { audit } from "@/lib/audit";
import { cancelBooking } from "@/lib/bookings";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  return respond(async () => {
    const b = await cancelBooking({ id: user.id, companyId, role: user.role }, id);
    await audit("予約を取り消し", `${b.date} ${b.start}〜${b.end} ${b.title}`);
    return { ok: true };
  });
}
