import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getBonusOverview, postBonus } from "@/lib/payroll/bonus";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getBonusOverview(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const run = await postBonus(companyId, body);
    await audit("賞与を計上", `${run.label} ${run.total.toLocaleString("ja-JP")}円`);
    return run;
  }, 201);
}
