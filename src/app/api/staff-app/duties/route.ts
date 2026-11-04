import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listDuties, myDuties } from "@/lib/duties";

// 自分の当番と、みんなの当番表(これから2週間)
export async function GET() {
  const user = await requireMember();
  return respond(async () => {
    const [mine, all] = await Promise.all([myDuties(user), listDuties(user.companyId)]);
    return { mine, roles: all.roles.map((r) => ({ id: r.id, name: r.name, weekdayLabel: r.weekdayLabel, note: r.note, schedule: r.schedule.map((s) => ({ date: s.date, name: s.name, me: s.userId === user.id })) })) };
  });
}
