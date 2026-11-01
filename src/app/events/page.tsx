import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import { listEvents } from "@/lib/companyEvents";
import EventsView from "./EventsView";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const companyId = await requireCompanyId();
  const [events, ai] = await Promise.all([listEvents(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">社内のイベント</h1>
        <p className="mt-1 text-sm text-slate-600">
          「12/20 19時 忘年会 居酒屋さくら 会費5000円 締切12/10」のように1行で書いて「読み取る」を押すと、日時・場所・会費・締め切りに分けます。案内{ai ? "(AIで下書きもできます)" : ""}は社内のお知らせに出し、従業員はClerkly従業員用の「社内のイベント」から出欠を答えます。出席の人の会費の受け取りと、答えていない人への催促もここでできます。
        </p>
      </div>
      <EventsView initial={JSON.parse(JSON.stringify(events))} ai={ai} today={jstDateKey(new Date())} />
    </div>
  );
}
