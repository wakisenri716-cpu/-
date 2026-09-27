import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getProjectSummaries } from "@/lib/accounting/projects";
import { getFiscalStartMonth, periodQuery, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";
import { formatYen } from "@/lib/format";
import { PeriodPicker } from "@/components/PeriodPicker";
import { ProjectManager } from "./ProjectManager";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const params = await searchParams;
  // 案件は期をまたぐことが多いので、既定は「すべての期間」
  const period = resolvePeriod({ preset: params.from || params.to ? undefined : "all", ...params }, await getFiscalStartMonth(companyId));
  const { rows, total } = await getProjectSummaries(companyId, toRange(period));
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const q = periodQuery(period);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">案件別損益</h1>
        <p className="mt-1 text-sm text-slate-600">
          工事・制作・受託などの案件ごとに、売上・原価と経費・利益を出します。請求書の発行、発注書の検収、仕訳の入力で案件を選ぶか、仕訳帳であとから案件を付けると集計されます。
        </p>
        <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
      </div>

      <PeriodPicker path="/projects" period={period} />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "案件の売上", value: total.revenue },
          { label: "案件の原価・経費", value: total.cost },
          { label: `案件の利益${total.margin === null ? "" : `(利益率 ${total.margin}%)`}`, value: total.profit },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${t.value < 0 ? "text-rose-700" : ""}`}>{formatYen(t.value)}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">案件</th>
                <th className="px-3 py-2 text-right font-medium">売上</th>
                <th className="px-3 py-2 text-right font-medium">原価・経費</th>
                <th className="px-3 py-2 text-right font-medium">利益</th>
                <th className="px-3 py-2 text-right font-medium">利益率</th>
                <th className="px-3 py-2 text-right font-medium">予算(受注額 / 原価)</th>
                <th className="px-3 py-2 text-left font-medium">原価の予算の消化</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "text-slate-400"}>
                  <td className="px-3 py-2">
                    <Link href={`/projects/${r.id}?${q}`} className="font-medium text-indigo-700 hover:underline">
                      {r.name}
                    </Link>
                    {!r.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">完了</span>}
                    {r.customerName && <span className="block text-xs text-slate-500">{r.customerName}</span>}
                  </td>
                  <td className={cell}>{formatYen(r.revenue)}</td>
                  <td className={cell}>{formatYen(r.cost)}</td>
                  <td className={`${cell} font-semibold ${r.profit < 0 ? "text-rose-700" : ""}`}>{formatYen(r.profit)}</td>
                  <td className={`${cell} ${r.margin !== null && r.margin < 0 ? "text-rose-700" : ""}`}>{r.margin === null ? "-" : `${r.margin}%`}</td>
                  <td className={`${cell} text-xs text-slate-500`}>
                    {r.budgetRevenue === null && r.budgetCost === null ? "-" : `${r.budgetRevenue === null ? "-" : formatYen(r.budgetRevenue)} / ${r.budgetCost === null ? "-" : formatYen(r.budgetCost)}`}
                  </td>
                  <td className="px-3 py-2">
                    {r.costUsed === null ? (
                      <span className="text-xs text-slate-400">-</span>
                    ) : (
                      <div className="flex min-w-32 items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`原価の予算の${r.costUsed}%`}>
                          <div className={`h-full rounded-full ${r.costUsed > 100 ? "bg-rose-500" : r.costUsed > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, r.costUsed)}%` }} />
                        </div>
                        <span className={`text-xs tabular-nums ${r.costUsed > 100 ? "font-semibold text-rose-700" : "text-slate-600"}`}>{r.costUsed}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    まだ案件がありません。下の「案件を登録」から登録してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProjectManager projects={rows} />
    </div>
  );
}
