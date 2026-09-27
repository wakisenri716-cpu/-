import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addGrant } from "@/lib/leave/service";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const grant = await addGrant(companyId, body);
    await audit("有給休暇を付与", `${grant.grantDate.toISOString().slice(0, 10)} ${grant.halfDays / 2}日`);
    return grant;
  }, 201);
}
