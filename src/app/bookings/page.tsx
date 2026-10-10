import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { jstDateKey } from "@/lib/jst";
import { listBookings, listFacilities } from "@/lib/bookings";
import BookingView from "./BookingView";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const today = jstDateKey(new Date());
  const [facilities, bookings] = await Promise.all([listFacilities(companyId), listBookings(companyId, today, 7)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">会議室・社用車の予約</h1>
        <p className="mt-1 text-sm text-slate-600">
          「明日14時から15時 会議室A 来客打ち合わせ」「金曜10時から2時間 社用車 さくら商事へ訪問」のように1行で書いて「読み取る」を押すと、予約するもの・日付・時刻・用件に分けます。同じものの時間が重なる予約は入れません。土日・祝日・会社の休業日の予約には注意を出します。空いている時間を押すと、その時間で下書きを作ります。
        </p>
      </div>
      <BookingView
        facilities={facilities.map((f) => ({ id: f.id, name: f.name, kind: f.kind, note: f.note }))}
        initial={JSON.parse(JSON.stringify(bookings))}
        today={today}
        viewerId={user.id}
        canManage={user.role === "ADMIN" || user.role === "ACCOUNTANT"}
      />
    </div>
  );
}
