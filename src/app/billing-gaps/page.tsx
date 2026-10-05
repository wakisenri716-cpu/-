import { requireCompanyId } from "@/lib/auth/session";
import { getBillingGaps } from "@/lib/billingGaps";
import { BillingGapsView } from "./BillingGapsView";

export const dynamic = "force-dynamic";

// 請求漏れのチェック
export default async function BillingGapsPage() {
  const companyId = await requireCompanyId();
  const r = await getBillingGaps(companyId);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">請求漏れのチェック</h1>
        <p className="mt-1 text-sm text-slate-600">
          出し忘れている請求書がないかを探します。毎月請求している顧客に今月まだ請求していないもの(定期発行に登録してある顧客は除きます)、受注した商談なのに請求書がないもの、出してから2週間以上たつのに請求書にしていない見積を出します。
        </p>
      </div>
      <BillingGapsView initial={r} />
    </div>
  );
}
