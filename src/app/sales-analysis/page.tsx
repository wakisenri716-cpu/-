import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getSalesAnalysis, POS_LABEL } from "@/lib/accounting/salesAnalysis";
import { getFiscalStartMonth, periodQuery, resolvePeriod, type PeriodParams } from "@/lib/accounting/period";
import { PeriodPicker } from "@/components/PeriodPicker";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
const RANK_STYLE: Record<string, string> = { A: "bg-indigo-600 text-white", B: "bg-indigo-200 text-indigo-900", C: "bg-slate-200 text-slate-700" };

function Change({ current, prior }: { current: number; prior: number | null }) {
  if (prior === null) return <span className="text-slate-300">-</span>;
  const diff = current - prior;
  if (diff === 0) return <span className="text-slate-400">±0</span>;
  return (
    <span className={diff > 0 ? "text-emerald-700" : "text-rose-700"}>
      {diff > 0 ? "+" : "−"}
      {formatYen(Math.abs(diff))}
      {prior > 0 && <span className="ml-1 text-xs">({diff > 0 ? "+" : ""}{Math.round((diff / prior) * 1000) / 10}%)</span>}
    </span>
  );
}

// 割合の横棒(数字は横に必ず出す)
function Bar({ share }: { share: number }) {
  return (
    <span className="block h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
      <span className="block h-1.5 rounded-full bg-indigo-500" style={{ width: `${Math.max(1, Math.min(100, share * 100))}%` }} />
    </span>
  );
}

export default async function SalesAnalysisPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const a = await getSalesAnalysis(companyId, period);
  const maxMonth = Math.max(1, ...a.monthly.flatMap((m) => [m.amount, m.prior ?? 0]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">売上分析</h1>
          <p className="mt-1 text-sm text-slate-600">発行した請求書と店頭売上(POSレジ)を税抜で集計し、顧客別(ABC分析)・品目別・月別に見ます。前年の同じ期間とも比べます。</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
        </div>
        <CsvDownloadLink href={`/api/sales-analysis/export?${periodQuery(period)}`} print />
      </div>

      <PeriodPicker path="/sales-analysis" period={period} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">売上(税抜)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(a.total)}</div>
          <div className="mt-1 text-xs text-slate-500">請求書 {a.invoiceCount}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">前年同期{a.priorRange && `(${a.priorRange.from.replaceAll("-", "/")}〜${a.priorRange.to.replaceAll("-", "/")})`}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{a.priorTotal === null ? "-" : formatYen(a.priorTotal)}</div>
          <div className="mt-1 text-sm tabular-nums">
            <Change current={a.total} prior={a.priorTotal} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">ABC分析</div>
          <ul className="mt-1 space-y-1 text-sm">
            {a.rankSummary.map((r) => (
              <li key={r.rank} className="flex items-center justify-between gap-2">
                <span>
                  <span className={`mr-1 inline-block w-5 rounded text-center text-xs font-semibold ${RANK_STYLE[r.rank]}`}>{r.rank}</span>
                  {r.count}社
                </span>
                <span className="tabular-nums">
                  {formatYen(r.amount)} <span className="text-xs text-slate-500">{a.total ? pct(r.amount / a.total) : "-"}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-4 py-2">
          <h2 className="text-sm font-semibold">顧客別(ABC分析)</h2>
          <p className="text-xs text-slate-500">売上の多い順に、累計で70%までの顧客をA(大事なお客様)、90%までをB、残りをCにしています。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">ランク</th>
                <th className="px-3 py-2">顧客</th>
                <th className="px-3 py-2 text-right">売上(税抜)</th>
                <th className="w-40 px-3 py-2">構成比・累計</th>
                <th className="px-3 py-2 text-right">前年同期比</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {a.customers.map((c) => (
                <tr key={c.name}>
                  <td className="px-3 py-2">
                    <span className={`inline-block w-6 rounded text-center text-xs font-semibold ${RANK_STYLE[c.rank]}`}>{c.rank}</span>
                  </td>
                  <td className="min-w-[9rem] px-3 py-2">
                    {c.name}
                    <span className="block text-xs text-slate-500">{c.name === POS_LABEL ? `${c.count}件` : `請求書 ${c.count}件`}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(c.amount)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                    <Bar share={c.share} />
                    {pct(c.share)}・累計 {pct(c.cumShare)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <Change current={c.amount} prior={c.prior} />
                  </td>
                </tr>
              ))}
              {a.customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    この期間の売上はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {a.lost.length > 0 && (
          <div className="border-t px-4 py-2 text-xs text-slate-600">
            <span className="font-medium text-rose-700">前年同期にはあったが、この期間に売上がない顧客:</span> {a.lost.slice(0, 10).map((l) => `${l.name}(${formatYen(l.prior)})`).join("、")}
            {a.lost.length > 10 && ` ほか${a.lost.length - 10}社`}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-2 text-sm font-semibold">品目別(請求書の明細)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2">品目</th>
                  <th className="px-3 py-2 text-right">売上</th>
                  <th className="px-3 py-2 text-right">数量</th>
                  <th className="px-3 py-2 text-right">前年同期比</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {a.items.slice(0, 30).map((i) => (
                  <tr key={i.name}>
                    <td className="min-w-[8rem] px-3 py-2">
                      {i.name}
                      <span className="mt-1 block text-xs text-slate-500">
                        <Bar share={i.share} />
                        {pct(i.share)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(i.amount)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{i.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      <Change current={i.amount} prior={i.prior} />
                    </td>
                  </tr>
                ))}
                {a.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      請求書の明細がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {a.items.length > 30 && <p className="border-t px-4 py-2 text-xs text-slate-500">上位30品目を表示しています(CSVには100品目まで入ります)。</p>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">月別の推移</h2>
            {a.priorRange && (
              <span className="flex items-center gap-3 text-xs text-slate-600">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm bg-indigo-500" />
                  この期間
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm bg-slate-300" />
                  前年
                </span>
              </span>
            )}
          </div>
          <ul className="space-y-2 text-sm">
            {a.monthly.map((m) => (
              <li key={m.month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
                <span className="text-xs text-slate-600">
                  {m.month.slice(0, 4)}/{Number(m.month.slice(5))}
                </span>
                <span className="space-y-0.5">
                  <span className="block h-2 rounded-sm bg-indigo-500" style={{ width: `${(m.amount / maxMonth) * 100}%` }} />
                  {m.prior !== null && <span className="block h-2 rounded-sm bg-slate-300" style={{ width: `${(m.prior / maxMonth) * 100}%` }} />}
                </span>
                <span className="text-right text-xs whitespace-nowrap tabular-nums">
                  {formatYen(m.amount)}
                  {m.prior !== null && <span className="block text-slate-400">{formatYen(m.prior)}</span>}
                </span>
              </li>
            ))}
            {a.monthly.length === 0 && <li className="py-4 text-center text-slate-400">売上がありません。</li>}
          </ul>
        </section>
      </div>

      <p className="text-xs text-slate-500">
        売上は請求書の請求日・POSレジの営業日で数え、税抜の金額です。仕訳を手で入れた売上は入りません(損益計算書の売上高とは違うことがあります)。
        <Link href="/income-statement" className="ml-1 text-indigo-700 hover:underline">
          損益計算書
        </Link>
      </p>
    </div>
  );
}
