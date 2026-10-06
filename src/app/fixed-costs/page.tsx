import { requireCompanyId } from "@/lib/auth/session";
import { findFixedCosts } from "@/lib/fixedCosts";
import { aiEnabled } from "@/lib/ai/access";
import FixedCostsView from "./FixedCostsView";

export const dynamic = "force-dynamic";

export default async function FixedCostsPage() {
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([findFixedCosts(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">固定費・サブスクの見直し</h1>
        <p className="mt-1 text-sm text-slate-600">
          帳簿から、直近6か月(今月を除く)のうち3か月以上ある支払いを「毎月の支払い」として集め、月と年間の金額、値上がり、同じ種類の支払いが重なっていないか、止まった支払いを出します(売上原価・給料・減価償却費・税金などは除きます)。{ai ? "「AIに見直しの候補を聞く」で、AIが解約の確認・プランの見直し・値下げの相談などの候補を付けます。" : ""}何も保存しません。
        </p>
      </div>
      <FixedCostsView initial={data} ai={ai} />
    </div>
  );
}
