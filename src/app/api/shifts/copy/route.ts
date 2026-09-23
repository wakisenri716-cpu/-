import { requireCompanyId } from "@/lib/auth/session";
import { copyPreviousWeek } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => copyPreviousWeek(companyId, String(body.week ?? "")));
}
