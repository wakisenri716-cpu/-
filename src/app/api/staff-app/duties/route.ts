import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listDuties, myDuties, mySwapRequests } from "@/lib/duties";

// 自分の当番と、みんなの当番表(これから2週間)
export async function GET() {
  const user = await requireMember();
  return respond(async () => {
    const [mine, all, swaps] = await Promise.all([myDuties(user), listDuties(user.companyId), mySwapRequests(user)]);
    return { mine, swaps, people: all.people.filter((p) => p.id !== user.id), roles: all.roles.map((r) => ({ id: r.id, name: r.name, weekdayLabel: r.weekdayLabel, note: r.note, schedule: r.schedule.map((s) => ({ date: s.date, name: s.name, me: s.userId === user.id })) })) };
  });
}
