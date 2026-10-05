import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { dismissDuplicate, findDuplicates } from "@/lib/duplicates";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => findDuplicates(companyId));
}

// { ids } この組み合わせは重複ではない
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await dismissDuplicate(companyId, user, body.ids);
    await audit("二重計上の候補を「重複ではない」に", `${Array.isArray(body.ids) ? body.ids.length : 0}件`);
    return r;
  });
}
