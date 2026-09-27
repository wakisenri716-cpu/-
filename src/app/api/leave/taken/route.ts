import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addTaken } from "@/lib/leave/service";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const taken = await addTaken(companyId, body);
    await audit("有給休暇の取得を登録", `${taken.date.toISOString().slice(0, 10)} ${taken.halfDays / 2}日`);
    return taken;
  }, 201);
}
