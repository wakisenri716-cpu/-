import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getReceiptForecast } from "@/lib/receiptForecast";
import { ReceiptForecastView } from "./ReceiptForecastView";

export const dynamic = "force-dynamic";

// 入金予測(入金待ちの請求書が、実際にはいつ入りそうか)
export default async function ReceiptForecastPage() {
  const companyId = await requireCompanyId();
  const f = await getReceiptForecast(companyId);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">入金予測</h1>
        <p className="mt-1 text-sm text-slate-600">
          入金待ちの請求書が、期日ではなく実際にはいつ入りそうかを、顧客ごとの過去の払い方(期日から何日後に払い終えたか)から見込みます。AIに見直してもらうと、払い方が遅くなってきた顧客などを遅めに見直します。
          <Link href="/cashflow?basis=forecast" className="ml-1 text-indigo-700 hover:underline">
            資金繰り予測に入金予測を使う →
          </Link>
        </p>
      </div>
      <ReceiptForecastView initial={f} />
    </div>
  );
}
