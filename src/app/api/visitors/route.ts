import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createVisitor, listVisitors, visitorLabel } from "@/lib/visitors";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  await requireMember();
  return respond(async () => ({ visitors: await listVisitors(companyId) }));
}

// 来客の予定を入れる: { date, time, visitorName, visitorCompany, partyKind, partyId, hostUserId, purpose }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const visitor = await createVisitor({ id: user.id, companyId, name: user.name }, body ?? {});
    await audit("来客の予定を登録", `${visitor.date}${visitor.time ? ` ${visitor.time}` : ""} ${visitorLabel(visitor)}`);
    return { visitor };
  }, 201);
}
