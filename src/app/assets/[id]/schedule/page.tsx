import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getFiscalStartMonth } from "@/lib/accounting/period";
import { decliningRates, depreciationSchedule, METHOD_LABEL, type DepreciationMethod } from "@/lib/accounting/depreciation";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const yen = (n: number) => n.toLocaleString("ja-JP");
const ym = (k: string) => `${k.slice(0, 4)}/${Number(k.slice(5))}`;

// 固定資産の償却予定表(年度ごとの期首帳簿価額・償却額・期末帳簿価額と、計上済みの額)
export default async function DepreciationSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId }, include: { depreciationEntries: true } });
  if (!asset) notFound();
  const [startMonth, company] = await Promise.all([getFiscalStartMonth(companyId), prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })]);
  const method = (asset.method === "DECLINING" ? "DECLINING" : "STRAIGHT") as DepreciationMethod;
  const schedule = depreciationSchedule({ ...asset, acquisitionMonth: asset.acquisitionDate.toISOString().slice(0, 7) }, startMonth);
  const rates = method === "DECLINING" ? decliningRates(asset.usefulLifeYears) : null;
  const postedIn = (from: string, to: string) => asset.depreciationEntries.filter((e) => e.period >= from && e.period <= to).reduce((s, e) => s + e.amount, 0);
  const total = schedule.reduce((s, y) => s + y.amount, 0);
  const posted = asset.depreciationEntries.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/assets" className="text-sm text-indigo-700 hover:underline">
          ← 固定資産
        </Link>
        <PrintButton />
      </div>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 print:border-0 print:p-0 print:shadow-none">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">減価償却の予定表</h1>
            <p className="text-lg">{asset.name}</p>
          </div>
          <p className="text-sm text-slate-600">{company.name}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">取得日</dt>
            <dd>{asset.acquisitionDate.toISOString().slice(0, 10).replaceAll("-", "/")}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">取得価額</dt>
            <dd className="tabular-nums">{yen(asset.acquisitionCost)}円</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">償却方法・耐用年数</dt>
            <dd>
              {METHOD_LABEL[method]}・{asset.usefulLifeYears}年
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{rates ? "償却率・改定償却率・保証率" : "残存価額"}</dt>
            <dd className="tabular-nums">{rates ? `${rates.rate.toFixed(3)}・${rates.revisedRate ? rates.revisedRate.toFixed(3) : "-"}・${rates.guarantee ? rates.guarantee.toFixed(5) : "-"}` : `${yen(asset.residualValue)}円`}</dd>
          </div>
        </dl>
        {rates && rates.guarantee > 0 && (
          <p className="text-xs text-slate-500">
            償却保証額 {yen(Math.floor(asset.acquisitionCost * rates.guarantee))}円(取得価額 × 保証率)。期首帳簿価額 × 償却率がこれを下回った年から、その年の期首帳簿価額 × 改定償却率で償却します。
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">年度</th>
                <th className="px-3 py-2 text-left">償却する月</th>
                <th className="px-3 py-2 text-right">期首帳簿価額</th>
                <th className="px-3 py-2 text-right">償却額</th>
                <th className="px-3 py-2 text-right">期末帳簿価額</th>
                <th className="px-3 py-2 text-right">計上済み</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {schedule.map((y) => {
                const done = postedIn(y.from, y.to);
                return (
                  <tr key={y.fiscalYear}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {y.fiscalYear}年度
                      {y.revised && <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-600">改定</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="whitespace-nowrap">
                        {ym(y.from)}〜{ym(y.to)}
                      </span>
                      <span className="block text-xs text-slate-500">{y.months}か月</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(y.opening)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{yen(y.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(y.closing)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${done === y.amount ? "text-emerald-700" : done ? "" : "text-slate-400"}`}>{done ? yen(done) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  合計
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{yen(total)}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{yen(posted)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          {method === "DECLINING" ? "平成24年4月1日以後に取得した資産の200%定率法で計算しています。" : "(取得価額 − 残存価額)÷ 耐用年数の月数 を毎月償却します。"}
          最後は帳簿価額が{yen(asset.residualValue)}円(備忘価額)になるまで償却します。{asset.disposedAt ? "この資産は除却・売却済みです。" : ""}
        </p>
      </section>
    </div>
  );
}
