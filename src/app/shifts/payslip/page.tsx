import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { getPayslip, ShiftError } from "@/lib/shifts/service";
import { getPayrollSheet } from "@/lib/payroll/service";
import { formatClock, formatMinutes } from "@/lib/shifts/pay";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function dayLabel(key: string) {
  const d = new Date(`${key}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`;
}

// スタッフに渡す給与明細(勤務の内訳と総支給額)。印刷・PDF保存して渡す。
export default async function PayslipPage({ searchParams }: { searchParams: Promise<{ staffId?: string; month?: string }> }) {
  const companyId = await requireCompanyId();
  const { staffId, month } = await searchParams;
  if (!staffId || !month) notFound();
  const [slip, company] = await Promise.all([
    getPayslip(companyId, staffId, month).catch((error) => {
      if (error instanceof ShiftError) return null;
      throw error;
    }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true } }),
  ]);
  if (!slip) notFound();
  const [y, m] = month.split("-").map(Number);
  const t = slip.total;
  // 控除(社会保険料・源泉所得税など)と差引支給額。計上済みなら計上したときの金額
  const d = (await getPayrollSheet(companyId, month)).rows.find((r) => r.staffId === staffId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/shifts" className="text-sm text-indigo-700 hover:underline">
          ← シフト管理
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-5 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-widest">給与明細書</h1>
            <p className="mt-1 text-sm">
              {y}年{m}月分
            </p>
          </div>
          <div className="text-right text-xs">
            <p className="text-sm font-semibold">{company.name}</p>
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
          </div>
        </header>

        <p className="mt-6 border-b border-slate-400 pb-1 text-lg font-semibold">{slip.staff.name} 様</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <table className="w-full text-xs">
            <caption className="mb-1 text-left text-xs font-semibold text-slate-600">勤怠</caption>
            <tbody className="divide-y border-y">
              {[
                ["出勤日数", `${slip.rows.length}日`],
                ["労働時間", formatMinutes(t.workMinutes)],
                ["うち深夜(22時〜5時)", formatMinutes(t.nightMinutes)],
                ["うち時間外(1日8時間超)", formatMinutes(t.overtimeMinutes)],
                ["時給", formatYen(slip.staff.hourlyWage)],
              ].map(([label, value]) => (
                <tr key={label}>
                  <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">{label}</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-xs">
            <caption className="mb-1 text-left text-xs font-semibold text-slate-600">支給</caption>
            <tbody className="divide-y border-y">
              {[
                ["基本給(時給×労働時間)", t.base],
                ["深夜割増(25%)", t.night],
                ["時間外割増(25%)", t.overtime],
              ].map(([label, value]) => (
                <tr key={label}>
                  <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">{label}</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(Number(value))}</td>
                </tr>
              ))}
              {d && d.commute > 0 && (
                <tr>
                  <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">通勤手当(非課税)</th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(d.commute)}</td>
                </tr>
              )}
              <tr className="border-t-2 border-slate-900">
                <th className="px-2 py-2 text-left font-semibold">総支給額</th>
                <td className="px-2 py-2 text-right text-base font-bold tabular-nums">{formatYen(d ? d.gross : t.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {d && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <table className="w-full text-xs">
              <caption className="mb-1 text-left text-xs font-semibold text-slate-600">控除</caption>
              <tbody className="divide-y border-y">
                {[
                  ["健康保険料", d.health],
                  ["介護保険料", d.care],
                  ["厚生年金保険料", d.pension],
                  ["雇用保険料", d.employment],
                  ["所得税", d.incomeTax],
                  ["住民税", d.residentTax],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <th className="bg-slate-50 px-2 py-1.5 text-left font-medium print:bg-slate-100">{label}</th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(Number(value))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-900">
                  <th className="px-2 py-2 text-left font-semibold">控除合計</th>
                  <td className="px-2 py-2 text-right font-bold tabular-nums">{formatYen(d.totalDeductions)}</td>
                </tr>
              </tbody>
            </table>
            <div className="flex flex-col justify-end">
              <div className="rounded-lg border-2 border-slate-900 px-4 py-3">
                <div className="text-xs text-slate-600">差引支給額(お振込額)</div>
                <div className="mt-1 text-right text-2xl font-bold tabular-nums">{formatYen(d.netPay)}</div>
              </div>
              {d.standardMonthly !== null && (
                <p className="mt-2 text-[11px] text-slate-500">
                  標準報酬月額 {formatYen(d.standardMonthly)}
                  {d.standardEstimated && "(目安)"}
                </p>
              )}
            </div>
          </div>
        )}

        <table className="mt-8 w-full border-collapse text-xs">
          <caption className="mb-1 text-left text-xs font-semibold text-slate-600">勤務の内訳</caption>
          <thead>
            <tr className="border-y border-slate-400 bg-slate-50 print:bg-slate-100">
              <th className="px-2 py-1.5 text-left font-medium">日付</th>
              <th className="px-2 py-1.5 text-left font-medium">時間</th>
              <th className="px-2 py-1.5 text-right font-medium">休憩</th>
              <th className="px-2 py-1.5 text-right font-medium">労働</th>
              <th className="px-2 py-1.5 text-right font-medium">支給額</th>
              <th className="px-2 py-1.5 text-left font-medium print:hidden">根拠</th>
            </tr>
          </thead>
          <tbody>
            {slip.rows.map((r) => (
              <tr key={r.date} className="border-b border-slate-200">
                <td className="px-2 py-1 whitespace-nowrap">{dayLabel(r.date)}</td>
                <td className="px-2 py-1 whitespace-nowrap tabular-nums">
                  {formatClock(r.startMinutes)}〜{formatClock(r.endMinutes)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{r.breakMinutes ? `${r.breakMinutes}分` : "-"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatMinutes(r.workMinutes)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatYen(Math.round(r.base + r.night + r.overtime))}</td>
                <td className="px-2 py-1 text-slate-500 print:hidden">{r.actual ? "打刻" : "シフト予定"}</td>
              </tr>
            ))}
            {slip.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-slate-400">
                  この月の勤務はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-4 text-[11px] text-slate-500">
          ※ 日ごとの支給額は四捨五入のため、合計と1円程度ずれることがあります。{!slip.posted && "この月の給料はまだ計上していないため、控除は計算中の金額です。"}
        </p>
      </article>
    </div>
  );
}
