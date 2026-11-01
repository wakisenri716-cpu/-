import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { memoContext } from "@/lib/phoneMemos";
import { carBookingsOn, lastOdometers, listChecks, missingChecks, pairTrips, tripTotals } from "@/lib/alcoholChecks";
import AlcoholView from "./AlcoholView";

export const dynamic = "force-dynamic";

export default async function AlcoholChecksPage() {
  const companyId = await requireCompanyId();
  const today = jstDateKey(new Date());
  const [bookings, missing, checks, ctx, cars, odometers] = await Promise.all([
    carBookingsOn(companyId, today),
    missingChecks(companyId),
    listChecks(companyId, `${today.slice(0, 7)}-01`, today),
    memoContext(companyId),
    prisma.facility.findMany({ where: { companyId, kind: "CAR", active: true }, select: { name: true }, orderBy: { name: "asc" } }),
    lastOdometers(companyId),
  ]);
  const trips = pairTrips(checks);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">アルコールチェック</h1>
        <p className="mt-1 text-sm text-slate-600">
          社用車を運転する人が、運転の前と後に酒気を帯びていないかを確かめて記録します(記録は1年間残してください)。今日の社用車の予約から1回の操作で記録でき、予約があるのに記録がないものはやることリストで知らせます。出発・帰着のメーターと行き先を入れると、運転日誌(走った距離)にもなります。月ごとの記録簿と運転日誌はCSVで出せます。
        </p>
      </div>
      <AlcoholView today={today} initialBookings={JSON.parse(JSON.stringify(bookings))} initialMissing={missing} initialChecks={JSON.parse(JSON.stringify(checks))} users={ctx.users.map((u) => ({ id: u.id, name: u.name }))} cars={cars.map((c) => c.name)} odometers={odometers} initialTrips={JSON.parse(JSON.stringify(trips))} initialTotals={tripTotals(trips)} />
    </div>
  );
}
