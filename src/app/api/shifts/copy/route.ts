import { getDefaultCompanyId } from "@/lib/demo";
import { copyPreviousWeek } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => copyPreviousWeek(companyId, String(body.week ?? "")));
}
