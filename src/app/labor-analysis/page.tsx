import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { getLaborAnalysis } from "@/lib/laborAnalysis";
import { aiEnabled } from "@/lib/ai/access";
import { formatYen } from "@/lib/format";
import { jstDateKey } from "@/lib/jst";
import LaborAdvice from "./LaborAdvice";

export const dynamic = "force-dynamic";

const monthText = (m: string) => `${m.slice(0, 4)}/${Number(m.slice(5))}`;
const SOURCE = { booked: "", shifts: "*", none: "" } as const;

export default async function LaborAnalysisPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const companyId = await requireCompanyId();
  const [r, ai] = await Promise.all([getLaborAnalysis(companyId, (await searchParams).month), aiEnabled(companyId)]);
  const max = Math.max(1, ...r.months.map((m) => Math.max(m.revenue, m.labor)));
  const staffMonths = [...new Set([...r.months.map((m) => m.month), jstDateKey(new Date()).slice(0, 7), r.month])].sort().reverse();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">人件費の分析</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近6か月(今月を除く)の売上・粗利(売上 − 売上原価)と人件費(給料手当・賞与・法定福利費)から、人件費率(人件費 ÷ 売上)と労働分配率(人件費 ÷ 粗利)を、シフト・打刻の勤務時間から1時間あたりの売上(人時売上高)を出します。スタッフごとの勤務時間・残業と、曜日ごとの1時間あたりの売上も見られます。何も保存しません。
        </p>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {r.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {ai && <LaborAdvice month={r.month} />}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">月ごと</h2>
        <div className="px-4 pt-4">
          <div className="flex h-32 items-end gap-3 border-b border-slate-200" role="img" aria-label="月ごとの売上と人件費の棒グラフ。数字は下の表にあります">
            {r.months.map((m) => (
              <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-1" title={`${monthText(m.month)} 売上 ${formatYen(m.revenue)}・人件費 ${formatYen(m.labor)}`}>
                <span className="w-4 rounded-t bg-indigo-500" style={{ height: `${(Math.max(m.revenue, 0) / max) * 100}%` }} />
                <span className="w-4 rounded-t bg-amber-500" style={{ height: `${(Math.max(m.labor, 0) / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-1 text-center text-[11px] text-slate-500">
            {r.months.map((m) => (
              <span key={m.month} className="flex-1">
                {Number(m.month.slice(5))}月
              </span>
            ))}
          </div>
          <p className="flex gap-4 py-2 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-indigo-500" />
              売上
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-amber-500" />
              人件費
            </span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">月</th>
                <th className="px-3 py-2 text-right">売上</th>
                <th className="px-3 py-2 text-right">粗利</th>
                <th className="px-3 py-2 text-right">人件費</th>
                <th className="px-3 py-2 text-right">人件費率</th>
                <th className="px-3 py-2 text-right">労働分配率</th>
                <th className="px-3 py-2 text-right">勤務時間</th>
                <th className="px-3 py-2 text-right">人時売上高</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.months.map((m) => (
                <tr key={m.month}>
                  <td className="px-3 py-2 whitespace-nowrap">{monthText(m.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(m.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(m.gross)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatYen(m.labor)}
                    {SOURCE[m.laborSource]}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.laborRatio === null ? "-" : `${m.laborRatio}%`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.laborShare === null ? "-" : `${m.laborShare}%`}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {m.hours ? `${m.hours}時間` : "-"}
                    {m.overtimeHours > 0 && <span className="block text-xs text-slate-500">残業 {m.overtimeHours}時間</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.salesPerHour === null ? "-" : formatYen(m.salesPerHour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-slate-500">* は給料をまだ計上していない月で、シフト・打刻から出した支給額で見ています。勤務時間はシフト・打刻のある分だけです。</p>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">スタッフごと({monthText(r.month)})</h2>
          <span className="ml-auto flex flex-wrap gap-1 text-xs">
            {staffMonths.map((m) => (
              <Link key={m} href={`/labor-analysis?month=${m}`} className={`rounded border px-2 py-0.5 ${m === r.month ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"}`}>
                {Number(m.slice(5))}月
              </Link>
            ))}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">スタッフ</th>
                <th className="px-3 py-2 text-right">日数</th>
                <th className="px-3 py-2 text-right">勤務時間</th>
                <th className="px-3 py-2 text-right">残業</th>
                <th className="px-3 py-2 text-right">深夜</th>
                <th className="px-3 py-2 text-right">支給額</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.staff.map((s) => (
                <tr key={s.staffId}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {s.name}
                    <span className="block text-xs text-slate-500">時給{formatYen(s.hourlyWage)}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{s.days}日</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{s.hours}時間</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${s.overLimit ? "font-semibold text-rose-700" : s.nearLimit ? "text-amber-700" : ""}`}>
                    {s.overtimeHours}時間{s.overLimit && <span className="block text-xs">45時間超</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{s.nightHours}時間</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(s.pay)}</td>
                </tr>
              ))}
              {r.staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    この月のシフト・打刻はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">曜日ごと(直近8週)</h2>
        {r.dailySales ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="px-3 py-2">曜日</th>
                  <th className="px-3 py-2 text-right">1日の売上</th>
                  <th className="px-3 py-2 text-right">1日の勤務時間</th>
                  <th className="px-3 py-2 text-right">1時間あたりの売上</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.weekdays.map((w) => (
                  <tr key={w.weekday}>
                    <td className="px-3 py-2">{w.weekday}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(w.salesPerDay)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{w.hoursPerDay}時間</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{w.salesPerHour === null ? "-" : formatYen(w.salesPerHour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-slate-500">売上が日ごとに記帳されていないため(月にまとめて記帳など)、曜日ごとの比較はできません。レジ(POS)の売上を日ごとに取り込むと見られます。</p>
        )}
      </section>
    </div>
  );
}
