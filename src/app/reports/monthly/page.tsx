import Link from "next/link";
import { Fragment } from "react";
import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { defaultMonth, getMonthlyReport, getMonthlyReports, type Facts } from "@/lib/assistant/monthlyReport";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";
import { GenerateButton } from "./GenerateButton";

export const dynamic = "force-dynamic";

const label = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// 「## 見出し」と「・」の行だけを読む(それ以外はそのまま段落)
function Body({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) =>
        line.startsWith("## ") ? (
          <h3 key={i} className="pt-3 text-base font-semibold first:pt-0">
            {line.slice(3)}
          </h3>
        ) : line.trim() ? (
          <p key={i} className={line.startsWith("・") ? "pl-4 -indent-4" : ""}>
            {line.replace(/\*\*(.+?)\*\*/g, "$1")}
          </p>
        ) : (
          <Fragment key={i} />
        ),
      )}
    </div>
  );
}

function Row({ name, v }: { name: string; v: { now: number; prevMonth: number; sameMonthLastYear: number } }) {
  const d = v.now - v.prevMonth;
  return (
    <tr>
      <td className="py-1.5">{name}</td>
      <td className="py-1.5 text-right font-medium tabular-nums">{formatYen(v.now)}</td>
      <td className="py-1.5 text-right text-slate-500 tabular-nums">{formatYen(v.prevMonth)}</td>
      <td className={`py-1.5 text-right tabular-nums ${d === 0 ? "text-slate-400" : (name === "費用" ? d < 0 : d > 0) ? "text-emerald-700" : "text-rose-700"}`}>
        {d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${formatYen(Math.abs(d))}`}
      </td>
      <td className="hidden py-1.5 text-right text-slate-500 tabular-nums sm:table-cell">{formatYen(v.sameMonthLastYear)}</td>
    </tr>
  );
}

export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const companyId = await requireCompanyId();
  const q = (await searchParams).month;
  const month = q && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : defaultMonth();
  const [report, list, company] = await Promise.all([getMonthlyReport(companyId, month), getMonthlyReports(companyId), prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })]);
  const facts = report?.facts as Facts | undefined;
  const thisMonth = jstDateKey(new Date()).slice(0, 7);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">AIの月次レポート</h1>
          <p className="mt-1 text-sm text-slate-600">その月の売上・費用・利益、増減の大きい科目、現預金、未入金をまとめ、AIが「よかったこと」「気をつけること」「来月やること」を書きます。</p>
        </div>
        {report && <PrintButton variant="outline" />}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <Link href={`/reports/monthly?month=${shift(month, -1)}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の月">
          ◀
        </Link>
        <span className="font-medium">{label(month)}</span>
        {month < thisMonth && (
          <Link href={`/reports/monthly?month=${shift(month, 1)}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の月">
            ▶
          </Link>
        )}
        {month === thisMonth && <span className="text-xs text-amber-700">今月はまだ途中です</span>}
        {list.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1 text-xs">
            {list.slice(0, 6).map((r) => (
              <Link key={r.month} href={`/reports/monthly?month=${r.month}`} className={`rounded-full border px-2 py-0.5 ${r.month === month ? "border-indigo-600 bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {label(r.month)}
              </Link>
            ))}
          </span>
        )}
      </div>

      <div className="print:hidden">
        <GenerateButton month={month} exists={!!report} />
      </div>

      {report && facts ? (
        <article className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-3">
            <div>
              <p className="text-xs text-slate-500">{company.name}</p>
              <h2 className="text-xl font-semibold">{label(month)}の月次レポート</h2>
            </div>
            <p className="text-xs text-slate-500">
              {report.mode === "claude" ? "AIが作成" : "決まった形で作成"}・{jstDateKey(report.createdAt).replaceAll("-", "/")} {report.createdBy}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-left font-medium" />
                <th className="py-1 text-right font-medium">この月</th>
                <th className="py-1 text-right font-medium">前月</th>
                <th className="py-1 text-right font-medium">前月比</th>
                <th className="hidden py-1 text-right font-medium sm:table-cell">前年同月</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <Row name="売上" v={facts.sales} />
              <Row name="費用" v={facts.expense} />
              <Row name="利益" v={facts.profit} />
            </tbody>
          </table>
          <p className="text-xs text-slate-500">
            月末の現預金 {formatYen(facts.cash.end)}(月初 {formatYen(facts.cash.start)})・期日を過ぎた未入金 {formatYen(facts.receivables.overdueTotal)}
          </p>
          <Body text={report.body} />
          <p className="text-xs text-slate-400 print:hidden">記帳済みの仕訳から作っています。あとから記帳を直したときは「いまの数字で作り直す」を押してください。</p>
        </article>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{label(month)}のレポートはまだありません。「レポートを作る」を押してください。</p>
      )}
    </div>
  );
}
