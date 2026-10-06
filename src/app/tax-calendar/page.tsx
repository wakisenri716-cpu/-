import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { getTaxCalendar } from "@/lib/taxCalendar";
import TaxCalendarView from "./TaxCalendarView";

export const dynamic = "force-dynamic";

export default async function TaxCalendarPage() {
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([getTaxCalendar(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">税金・労務のカレンダー</h1>
        <p className="mt-1 text-sm text-slate-600">
          決算月・納期の特例・社会保険の加入者・固定資産などの設定から、これから12か月の申告・届出・納付の期限を並べます。源泉所得税・住民税は「源泉徴収・納付」で納付済みにすると自動で「済み」になります。期限は一般的な目安です(土日は次の月曜日。祝日は考えていません)。
        </p>
      </div>
      <TaxCalendarView initial={data} ai={ai} />
    </div>
  );
}
