import { getConsumptionTax } from "@/lib/accounting/consumptionTax";
import { requireCompanyId } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { PeriodPicker } from "@/components/PeriodPicker";
import { getFiscalStartMonth, periodQuery, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

export default async function TaxPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const { rows, outputTotal, inputTotal, payable } = await getConsumptionTax(companyId, toRange(period));
  const refund = payable < 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">消費税集計</h1>
          <p className="mt-1 text-sm text-slate-600">
            売上で預かった消費税(仮受消費税)と、仕入・経費で支払った消費税(仮払消費税)を集計し、納める消費税の目安を計算します。
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
        </div>
        <CsvDownloadLink href={`/api/tax/export?${periodQuery(period)}`} />
      </div>

      <PeriodPicker path="/tax" period={period} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">預かった消費税(仮受消費税)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(outputTotal)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">支払った消費税(仮払消費税)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(inputTotal)}</div>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${refund ? "border-emerald-200 bg-emerald-50" : "border-indigo-200 bg-indigo-50"}`}>
          <div className={`text-xs ${refund ? "text-emerald-700" : "text-indigo-700"}`}>{refund ? "還付される見込み" : "納める見込み"}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(Math.abs(payable))}</div>
          <div className="mt-1 text-xs text-slate-500">預かった − 支払った</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">発生元</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">預かった消費税</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">支払った消費税</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.source}>
                  <td className="px-4 py-2 whitespace-nowrap">{row.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{row.output ? formatYen(row.output) : "-"}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{row.input ? formatYen(row.input) : "-"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                    この期間に消費税の仕訳はありません。
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 bg-slate-50 font-semibold">
              <tr>
                <td className="px-4 py-3">合計</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{formatYen(outputTotal)}</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{formatYen(inputTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="space-y-1 text-xs text-slate-500">
        <p>・記帳済みの仕訳(レビュー待ち・取消は除く)の「仮受消費税」「仮払消費税」を集計しています。</p>
        <p>・「原則課税」で計算した目安です。簡易課税や2割特例を選んでいる場合、中間納付がある場合は、実際の納付額が変わります。</p>
        <p>・申告の前に、税理士または税務署で金額を確認してください。</p>
      </div>
    </div>
  );
}
