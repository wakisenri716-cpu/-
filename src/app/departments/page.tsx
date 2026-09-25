import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getDepartmentPL, listDepartments } from "@/lib/accounting/departments";
import { getFiscalStartMonth, periodQuery, resolvePeriod, toRange, type PeriodParams } from "@/lib/accounting/period";
import { formatYen } from "@/lib/format";
import { CsvDownloadLink } from "@/components/CsvDownloadLink";
import { PeriodPicker } from "@/components/PeriodPicker";
import { DepartmentManager } from "./DepartmentManager";

export const dynamic = "force-dynamic";

type Line = { amounts: Record<string, number>; total: number };

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(await searchParams, await getFiscalStartMonth(companyId));
  const [departments, pl] = await Promise.all([listDepartments(companyId), getDepartmentPL(companyId, toRange(period))]);
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

  const row = (key: string, label: React.ReactNode, line: Line, strong = false) => (
    <tr key={key} className={strong ? "border-t bg-slate-50/70 font-semibold" : ""}>
      <th scope="row" className={`px-3 py-2 text-left whitespace-nowrap ${strong ? "" : "font-normal"}`}>
        {label}
      </th>
      {pl.columns.map((c) => {
        const v = line.amounts[c.id] ?? 0;
        return (
          <td key={c.id} className={`${cell} ${v < 0 ? "text-rose-700" : ""}`}>
            {v === 0 ? "-" : formatYen(v)}
          </td>
        );
      })}
      <td className={`${cell} border-l font-semibold ${line.total < 0 ? "text-rose-700" : ""}`}>{formatYen(line.total)}</td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">部門別損益</h1>
          <p className="mt-1 text-sm text-slate-600">店舗・事業部などの部門ごとに、売上・費用・利益を並べます。仕訳に部門を付けておくと集計されます。</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{period.label}</p>
        </div>
        <CsvDownloadLink href={`/api/departments/export?${periodQuery(period)}`} print />
      </div>

      <PeriodPicker path="/departments" period={period} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">科目</th>
                {pl.columns.map((c) => (
                  <th key={c.id} className="px-3 py-2 text-right font-medium">
                    {c.name}
                  </th>
                ))}
                <th className="border-l px-3 py-2 text-right font-medium">合計</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td colSpan={pl.columns.length + 2} className="bg-slate-50/60 px-3 py-1 text-xs font-semibold text-slate-500">
                  収益
                </td>
              </tr>
              {pl.revenue.map((r) =>
                row(
                  r.accountId,
                  <Link href={`/ledger?accountId=${r.accountId}`} className="hover:underline">
                    {r.code} {r.name}
                  </Link>,
                  r,
                ),
              )}
              {row("rev-total", "収益合計", pl.revenueTotal, true)}
              <tr>
                <td colSpan={pl.columns.length + 2} className="bg-slate-50/60 px-3 py-1 text-xs font-semibold text-slate-500">
                  費用
                </td>
              </tr>
              {pl.expense.map((r) =>
                row(
                  r.accountId,
                  <Link href={`/ledger?accountId=${r.accountId}`} className="hover:underline">
                    {r.code} {r.name}
                  </Link>,
                  r,
                ),
              )}
              {row("exp-total", "費用合計", pl.expenseTotal, true)}
              {row("profit", "利益", pl.profit, true)}
            </tbody>
          </table>
        </div>
        {pl.columns.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">この期間の売上・費用の仕訳はまだありません。</p>}
      </div>

      <DepartmentManager departments={departments} />
    </div>
  );
}
