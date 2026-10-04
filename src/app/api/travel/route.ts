import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addTripToExpenses, getPolicy, listTrips } from "@/lib/travel";
import { audit } from "@/lib/audit";

// 規程と出張の一覧(従業員は自分の出張だけ)
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ policy: await getPolicy(user.companyId), trips: await listTrips(user), canEditPolicy: user.role !== "EMPLOYEE" }));
}

// 出張を記録して、日当・宿泊費を経費精算に入れる
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await addTripToExpenses(user, body);
    await audit("出張の日当・宿泊費を経費精算に追加", `${r.trip.destination} ${r.total.toLocaleString()}円`);
    return { reportId: r.reportId, total: r.total };
  }, 201);
}
