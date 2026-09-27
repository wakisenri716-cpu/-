import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { getBonusRun } from "@/lib/payroll/bonus";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// 賞与明細書(1人1枚。まとめて印刷すると1人ずつページが分かれる)
export default async function BonusSlipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const run = await getBonusRun(companyId, id);
  if (!run) notFound();
  const payDate = run.payDate.toISOString().slice(0, 10).split("-").map(Number);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/bonus" className="text-sm text-indigo-700 hover:underline">
          ← 賞与
        </Link>
        <PrintButton />
      </div>
      {run.rows.map((r) => (
        <article
          key={r.staffId}
          className="mx-auto max-w-[210mm] break-after-page bg-white p-5 text-[13px] text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0"
        >
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-widest">賞与明細書</h1>
              <p className="mt-1 text-sm">
                {run.label}(支給日 {payDate[0]}年{payDate[1]}月{payDate[2]}日)
              </p>
            </div>
            <div className="text-right text-xs">
              <p className="text-sm font-semibold">{run.company.name}</p>
              {run.company.address && <p className="whitespace-pre-line">{run.company.address}</p>}
            </div>
          </header>
          <p className="mt-6 border-b border-slate-400 pb-1 text-lg font-semibold">{r.name} 様</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <table className="w-full text-xs">
              <caption className="mb-1 text-left text-xs font-semibold text-slate-600">支給</caption>
              <tbody className="divide-y border-y">
                <tr>
                  <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">賞与</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(r.amount)}</td>
                </tr>
                <tr>
                  <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">標準賞与額</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(r.standard)}</td>
                </tr>
              </tbody>
            </table>
            <table className="w-full text-xs">
              <caption className="mb-1 text-left text-xs font-semibold text-slate-600">控除</caption>
              <tbody className="divide-y border-y">
                {(
                  [
                    ["健康保険料", r.health],
                    ["介護保険料", r.care],
                    ["厚生年金保険料", r.pension],
                    ["雇用保険料", r.employment],
                    [`所得税(${r.taxRate}%)`, r.incomeTax],
                  ] as const
                ).map(([label, value]) => (
                  <tr key={label}>
                    <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">{label}</th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(value)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-900">
                  <th className="px-2 py-2 text-left font-semibold">控除合計</th>
                  <td className="px-2 py-2 text-right font-bold tabular-nums">{formatYen(r.socialTotal + r.incomeTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-6 ml-auto max-w-xs rounded-lg border-2 border-slate-900 px-4 py-3">
            <div className="text-xs text-slate-600">差引支給額(お振込額)</div>
            <div className="mt-1 text-right text-2xl font-bold tabular-nums">{formatYen(r.netPay)}</div>
          </div>
        </article>
      ))}
    </div>
  );
}
