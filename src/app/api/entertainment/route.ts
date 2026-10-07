import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getEntertainment, saveEntertainmentRecord } from "@/lib/entertainment";

// 今期の交際費(上限との比べ・明細と記録)
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getEntertainment(companyId));
}

// 明細の記録(種類・人数・相手・目的)を保存する。{ lineId, kind, persons, guests, purpose }
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    await saveEntertainmentRecord(user, body);
    return getEntertainment(user.companyId);
  });
}
