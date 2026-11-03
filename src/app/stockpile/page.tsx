import { requireCompanyId } from "@/lib/auth/session";
import { listStock } from "@/lib/stockpile";
import StockpileView from "./StockpileView";

export const dynamic = "force-dynamic";

export default async function StockpilePage() {
  const companyId = await requireCompanyId();
  const data = await listStock(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">防災の備蓄品</h1>
        <p className="mt-1 text-sm text-slate-600">
          「保存水 2L 24本 2030/3まで 倉庫」「アルファ米 50食 令和11年10月」のように1行で書いて「読み取る」を押すと、品物・数・1つあたりの量・期限・置き場所に分けて記録します(月だけの期限は月末にします)。社員の人数から、3日分(水は1人1日3リットル・食料は1日3食・簡易トイレは1日5回)が足りるかを見て、期限が90日以内のもの・切れたものを、ここと やることリストで知らせます。
        </p>
      </div>
      <StockpileView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
