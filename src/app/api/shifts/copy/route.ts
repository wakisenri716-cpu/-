import { requireCompanyId } from "@/lib/auth/session";
import { copyPreviousWeek } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";
import { notifyShiftsBulk } from "@/lib/push/events";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const { shifts, ...result } = await copyPreviousWeek(companyId, String(body.week ?? ""));
    notifyShiftsBulk(companyId, shifts);
    return result;
  });
}
