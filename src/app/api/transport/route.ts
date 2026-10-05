import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addRides, listRoutes } from "@/lib/transport";
import { audit } from "@/lib/audit";

// 自分の経路と、最近入れた交通費
export async function GET() {
  const user = await requireMember();
  return respond(() => listRoutes(user));
}

// { routeId, dates, oneWay, purpose } 乗った日の交通費を経費精算に入れる
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await addRides(user, body);
    await audit("交通費を経費精算に追加", `${Array.isArray(body.dates) ? body.dates.length : 0}日分 ${r.total.toLocaleString()}円`);
    return r;
  }, 201);
}
