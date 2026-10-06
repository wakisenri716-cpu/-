import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getBudgetProgress, type ProgressStatus } from "@/lib/accounting/budgetProgress";
import { formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS: Record<ProgressStatus, { label: string; cls: string }> = {
  OVER: { label: "予算を超えた", cls: "bg-rose-100 text-rose-800" },
  RISK: { label: "超えそう", cls: "bg-amber-100 text-amber-800" },
  BEHIND: { label: "届かなそう", cls: "bg-amber-100 text-amber-800" },
  ACHIEVED: { label: "達成", cls: "bg-emerald-100 text-emerald-800" },
  OK: { label: "順調", cls: "bg-slate-100 text-slate-700" },
  NONE: { label: "-", cls: "text-slate-400" },
};

type Row = Awaited<ReturnType<typeof getBudgetProgress>>["expense"][number];

// 実績の棒と、経過月数分の予算の位置(縦線)。数字は表に出す
function Meter({ row }: { row: Row }) {
  if (!row.budget) return null;
  const max = Math.max(row.budget, row.actual, 1);
  const color = row.status === "OVER" ? "bg-rose-500" : row.status === "RISK" || row.status === "BEHIND" ? "bg-amber-500" : "bg-indigo-500";
  return (
    <span className="relative mt-1 block h-2 w-full rounded-full bg-slate-100" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${(row.actual / max) * 100}%` }} />
      {row.pace !== null && <span className="absolute -top-0.5 h-3 w-0.5 bg-slate-700" style={{ left: `${(row.pace / max) * 100}%` }} />}
    </span>
  );
}

function Table({ title, rows, total, note }: { title: string; rows: Row[]; total: { budget: number; pace: number; actual: number; forecast: number }; note: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-slate-500">{note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
            <tr>
              <th className="px-3 py-2">科目</th>
              <th className="px-3 py-2 text-right">年間予算</th>
              <th className="px-3 py-2 text-right">今月までの予算</th>
              <th className="px-3 py-2 text-right">実績</th>
              <th className="px-3 py-2 text-right">着地見込み</th>
              <th className="hidden px-3 py-2 sm:table-cell">判定</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.accountId}>
                <td className="min-w-[10rem] px-3 py-2">
                  <Link href={`/ledger?accountId=${r.accountId}`} className="hover:underline">
                    {r.code} {r.name}
                  </Link>
                  <Meter row={r} />
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium sm:hidden ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(r.budget ?? 0)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-slate-500 tabular-nums">{formatYen(r.pace ?? 0)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {formatYen(r.actual)}
                  {r.rate !== null && <span className="block text-xs text-slate-500">予算の{Math.round(r.rate * 100)}%</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{r.forecast === null ? "-" : formatYen(r.forecast)}</td>
                <td className="hidden px-3 py-2 whitespace-nowrap sm:table-cell">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  予算を入れた科目がありません。
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 font-semibold">
              <tr>
                <td className="px-3 py-2">合計</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(total.budget)}</td>
                <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{formatYen(total.pace)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(total.actual)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(total.forecast)}</td>
                <td className="hidden sm:table-cell" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

export default async function BudgetProgressPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const companyId = await requireCompanyId();
  const p = await getBudgetProgress(companyId, (await searchParams).fy);
  const profitBudget = p.revenueTotal.budget - p.expenseTotal.budget;
  const profitForecast = p.revenueTotal.forecast - p.expenseTotal.forecast;
  const hasBoth = p.revenue.length > 0 && p.expense.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/monthly?fy=${p.year}`} className="text-sm text-indigo-700 hover:underline">
          ← 月次推移・予算
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">予算の進み具合</h1>
        <p className="mt-1 text-sm text-slate-600">
          年間予算を12か月で均等に使うとして、今月までに使ってよい予算(縦線)と実績を比べ、このままのペースで1年たったときの着地見込みを出します。費用が予算を超えた・超えそうな科目と、売上が届かなそうな科目に印をつけます。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/monthly/progress?fy=${p.year - 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年度">
          ◀
        </Link>
        <span className="font-medium">
          {p.year}年度({p.months[0].replace("-", "/")}〜{p.months[11].replace("-", "/")}・{p.elapsed === 12 ? "終わった年度" : p.elapsed === 0 ? "これからの年度" : `${p.elapsed}か月目`})
        </span>
        <Link href={`/monthly/progress?fy=${p.year + 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年度">
          ▶
        </Link>
        {p.year !== p.current && (
          <Link href="/monthly/progress" className="text-indigo-700 hover:underline">
            今期
          </Link>
        )}
        <Link href={`/monthly/budget?fy=${p.year}`} className="ml-auto rounded-md border border-indigo-600 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
          予算を入れる・直す
        </Link>
      </div>

      {p.alerts > 0 && (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
          気をつけたい科目が {p.alerts}件 あります(下の表の「超えた」「超えそう」「届かなそう」)。
          <Link href={`/monthly/variance?fy=${p.year}`} className="ml-1 font-medium text-amber-900 underline">
            差の原因を見る →
          </Link>
        </p>
      )}

      {hasBoth && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">利益の予算(年間・予算を入れた科目)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(profitBudget)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">利益の実績(今月まで)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(p.revenueTotal.actual - p.expenseTotal.actual)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">利益の着地見込み</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${profitForecast < profitBudget ? "text-rose-700" : "text-emerald-700"}`}>{formatYen(profitForecast)}</div>
            <div className="mt-1 text-xs text-slate-500">予算との差 {profitForecast - profitBudget >= 0 ? "+" : "−"}{formatYen(Math.abs(profitForecast - profitBudget))}</div>
          </div>
        </div>
      )}

      <Table title="売上・収益" rows={p.revenue} total={p.revenueTotal} note="着地見込みが予算の95%に届かないと「届かなそう」、実績が予算に届くと「達成」です。" />
      <Table title="費用" rows={p.expense} total={p.expenseTotal} note="実績が年間予算を超えると「予算を超えた」、着地見込みが予算を超えると「超えそう」です。" />

      <p className="text-xs text-slate-500">
        季節で増減する科目(賞与・決算の費用など)は、均等に使う前提だと早めに印がつくことがあります。{p.unbudgeted > 0 && `予算を入れていない科目が${p.unbudgeted}件あります。`}
      </p>
    </div>
  );
}
