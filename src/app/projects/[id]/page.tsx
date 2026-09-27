import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getProjectDetail } from "@/lib/accounting/projects";
import { getFiscalStartMonth, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";
import { formatYen } from "@/lib/format";
import { PeriodPicker } from "@/components/PeriodPicker";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<PeriodParams> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const sp = await searchParams;
  const period = resolvePeriod({ preset: sp.from || sp.to ? undefined : "all", ...sp }, await getFiscalStartMonth(companyId));
  const data = await getProjectDetail(companyId, id, toRange(period));
  if (!data) notFound();
  const { project, totals } = data;
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const budgetProfit = project.budgetRevenue !== null && project.budgetCost !== null ? project.budgetRevenue - project.budgetCost : null;

  const section = (title: string, rows: { code: string; name: string; amount: number }[], total: number) => (
    <>
      <tr className="bg-slate-50 text-xs text-slate-500">
        <th colSpan={2} className="px-3 py-1.5 text-left font-medium">
          {title}
        </th>
      </tr>
      {rows.map((r) => (
        <tr key={r.code}>
          <td className="px-3 py-2">
            <span className="mr-2 text-xs text-slate-400">{r.code}</span>
            {r.name}
          </td>
          <td className={cell}>{formatYen(r.amount)}</td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td colSpan={2} className="px-3 py-2 text-xs text-slate-400">
            なし
          </td>
        </tr>
      )}
      <tr className="border-t font-semibold">
        <td className="px-3 py-2">{title}の合計</td>
        <td className={cell}>{formatYen(total)}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-indigo-700 hover:underline">
          ← 案件別損益
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {project.name}
          {!project.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 align-middle text-xs font-medium text-slate-500">完了</span>}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {[
            project.customerName && `顧客 ${project.customerName}`,
            (project.startDate || project.endDate) && `期間 ${project.startDate?.replaceAll("-", "/") ?? ""}〜${project.endDate?.replaceAll("-", "/") ?? ""}`,
            project.notes,
          ]
            .filter(Boolean)
            .join(" ・ ")}
        </p>
        <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
      </div>

      <PeriodPicker path={`/projects/${project.id}`} period={period} />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "売上", value: totals.revenue, budget: project.budgetRevenue },
          { label: "原価・経費", value: totals.cost, budget: project.budgetCost },
          { label: `利益${totals.margin === null ? "" : `(利益率 ${totals.margin}%)`}`, value: totals.profit, budget: budgetProfit },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${t.value < 0 ? "text-rose-700" : ""}`}>{formatYen(t.value)}</p>
            {t.budget !== null && <p className="mt-1 text-xs text-slate-500">予算 {formatYen(t.budget)}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">科目ごとの内訳</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {section("売上", data.revenue, totals.revenue)}
              {section("原価・経費", data.expense, totals.cost)}
              <tr className="border-t-2 bg-slate-50 font-semibold">
                <td className="px-3 py-2">利益</td>
                <td className={`${cell} ${totals.profit < 0 ? "text-rose-700" : ""}`}>{formatYen(totals.profit)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">この案件の仕訳</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">日付</th>
                  <th className="px-3 py-2 text-left font-medium">摘要</th>
                  <th className="px-3 py-2 text-right font-medium">損益への影響</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{e.date.replaceAll("-", "/")}</td>
                    <td className="px-3 py-2">{e.description}</td>
                    <td className={`${cell} ${e.pl < 0 ? "text-rose-700" : e.pl > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                      {e.pl === 0 ? "-" : `${e.pl > 0 ? "+" : "−"}${formatYen(Math.abs(e.pl))}`}
                    </td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                      この期間に案件の付いた仕訳はありません。仕訳帳で仕訳に案件を付けてください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
