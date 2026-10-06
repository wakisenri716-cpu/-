import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getTaxForecast } from "@/lib/taxForecast";
import { aiEnabled } from "@/lib/ai/access";
import TaxForecastView from "./TaxForecastView";

export const dynamic = "force-dynamic";

export default async function TaxForecastPage() {
  const companyId = await requireCompanyId();
  const [f, ai] = await Promise.all([getTaxForecast(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">今期の着地見込みと納税の目安</h1>
        <p className="mt-1 text-sm text-slate-600">
          今期({f.from.replaceAll("-", "/")}〜{f.to.replaceAll("-", "/")})の終わった月の実績に、直近3か月の1か月平均 × 残りの月数を足して、期末の利益と法人税等(標準税率の目安)、納付の額と期限を出します。決算までにできることの金額を入れると、税金とお金の動きがどう変わるかも見られます。何も保存しません。実際の申告・節税の判断は、必ず税理士に確かめてください。
        </p>
        <p className="mt-1 text-sm">
          <Link href="/corporate-tax" className="text-indigo-700 hover:underline">
            法人税等の計算(加算・減算・繰越欠損金の入力と計上)
          </Link>
        </p>
      </div>
      <TaxForecastView f={f} ai={ai} />
    </div>
  );
}
