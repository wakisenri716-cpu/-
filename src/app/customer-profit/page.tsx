import { requireCompanyId } from "@/lib/auth/session";
import { getCustomerProfit } from "@/lib/customerProfit";
import { aiEnabled } from "@/lib/ai/access";
import CustomerProfitView from "./CustomerProfitView";

export const dynamic = "force-dynamic";

export default async function CustomerProfitPage() {
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([getCustomerProfit(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">顧客別の採算</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近12か月({data.from.replaceAll("-", "/")}〜{data.to.replaceAll("-", "/")})に発行した請求書の売上(税抜)から、その顧客の案件(案件の顧客名が同じもの)に付いた原価・経費の仕訳と、日報の作業時間 × 時間単価を引いて、顧客ごとの粗利と1時間あたりの粗利を出します。入金の遅れも並べます。何も保存しません。
        </p>
      </div>
      <CustomerProfitView initial={data} ai={ai} />
    </div>
  );
}
