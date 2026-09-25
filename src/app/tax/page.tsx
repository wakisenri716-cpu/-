import { BUSINESS_TYPES, TAX_METHODS, estimateByMethod, getConsumptionTax, isTaxMethod, type TaxMethod } from "@/lib/accounting/consumptionTax";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { TaxMethodForm } from "./TaxMethodForm";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { PeriodPicker } from "@/components/PeriodPicker";
import { getFiscalStartMonth, periodQuery, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";

export const dynamic = "force-dynamic";

export default async function TaxPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const [{ rows, outputTotal, inputTotal }, company, user] = await Promise.all([
    getConsumptionTax(companyId, toRange(period)),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { consumptionTaxMethod: true, simplifiedBusinessType: true } }),
    requireUser(),
  ]);
  const method: TaxMethod = isTaxMethod(company.consumptionTaxMethod) ? company.consumptionTaxMethod : "GENERAL";
  const businessType = BUSINESS_TYPES[company.simplifiedBusinessType] ? company.simplifiedBusinessType : 5;
  const estimates = estimateByMethod(outputTotal, inputTotal, businessType);
  const payable = estimates[method];
  const refund = payable < 0;
  const lowest = Math.min(...Object.values(estimates));
  const methodNotes: Record<TaxMethod, string> = {
    GENERAL: "預かった消費税 − 支払った消費税",
    SIMPLIFIED: `預かった消費税 ×(1 − みなし仕入率${Math.round(BUSINESS_TYPES[businessType].rate * 100)}%)`,
    TWENTY_PERCENT: "預かった消費税 × 20%",
  };

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
        <CsvDownloadLink href={`/api/tax/export?${periodQuery(period)}`} print />
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
          <div className="mt-1 text-xs text-slate-500">
            {TAX_METHODS[method]}: {methodNotes[method]}
          </div>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-medium">計算方式ごとの比較</h2>
          <p className="mt-1 text-xs text-slate-500">
            同じ期間の数字を3つの方式で計算した目安です。現在の設定は「{TAX_METHODS[method]}
            {method === "SIMPLIFIED" && `・${BUSINESS_TYPES[businessType].label}(${BUSINESS_TYPES[businessType].example})`}」です。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(TAX_METHODS) as TaxMethod[]).map((m) => (
            <div key={m} className={`rounded-lg border p-3 ${m === method ? "border-indigo-300 bg-indigo-50" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {TAX_METHODS[m]}
                {m === method && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] text-white">設定中</span>}
                {estimates[m] === lowest && outputTotal > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">最も少ない</span>}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {estimates[m] < 0 ? `還付 ${formatYen(-estimates[m])}` : formatYen(estimates[m])}
              </div>
              <div className="mt-1 text-xs text-slate-500">{methodNotes[m]}</div>
            </div>
          ))}
        </div>
        {user.role === "ADMIN" ? (
          <TaxMethodForm
            method={method}
            businessType={businessType}
            methods={Object.entries(TAX_METHODS).map(([value, label]) => ({ value, label }))}
            businessTypes={Object.entries(BUSINESS_TYPES).map(([value, t]) => ({ value, label: `${t.label} ${Math.round(t.rate * 100)}%(${t.example})` }))}
          />
        ) : (
          <p className="text-xs text-slate-500 print:hidden">計算方式は管理者が変更できます。</p>
        )}
      </section>

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
        <p>・簡易課税は、前々年(基準期間)の課税売上高が5,000万円以下で、事前に届出をした場合に使えます。事業区分が複数ある場合や中間納付がある場合は、実際の納付額が変わります。</p>
        <p>・2割特例は、インボイス登録をきっかけに免税事業者から課税事業者になった方が、2026年9月30日を含む課税期間まで使える特例です。</p>
        <p>・税率ごとの端数処理・国税と地方消費税の区分は簡略化しています。</p>
        <p>・申告の前に、税理士または税務署で金額を確認してください。</p>
      </div>
    </div>
  );
}
