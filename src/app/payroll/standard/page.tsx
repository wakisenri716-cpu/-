import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getStandardReview } from "@/lib/payroll/standardReview";
import { PrintButton } from "@/components/PrintButton";
import { ReviewActions } from "./ReviewActions";

export const dynamic = "force-dynamic";

const yen = (n: number | null) => (n === null ? "-" : n.toLocaleString("ja-JP"));
const thousand = (n: number | null) => (n === null ? "-" : `${(n / 1000).toLocaleString("ja-JP")}千円`);

export default async function StandardReviewPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const companyId = await requireCompanyId();
  const { year } = await searchParams;
  const [review, company] = await Promise.all([getStandardReview(companyId, year), prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })]);
  const changing = review.rows.filter((r) => r.next !== null && r.next !== r.current);

  return (
    <div className="space-y-5">
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">社会保険の算定基礎(標準報酬月額の見直し)</h1>
            <p className="mt-1 text-sm text-slate-600">
              毎年7月10日までに出す「算定基礎届」のための計算です。4・5・6月に支払った給与(通勤手当を含む)の平均から、9月分からの新しい標準報酬月額(健康保険・厚生年金)を決めます。反映すると、給与計算の社会保険料がその金額で計算されます。
            </p>
          </div>
          <PrintButton variant="outline" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/payroll/standard?year=${review.year - 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の年">
            ◀
          </Link>
          <span className="font-medium">{review.year}年</span>
          <Link href={`/payroll/standard?year=${review.year + 1}`} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="次の年">
            ▶
          </Link>
          <span className="text-slate-500">
            (4〜6月に支払った給与 = {review.paidMonths.map((p) => `${Number(p.workMonth.slice(5))}月分`).join("・")}
            {review.salaryPaidNextMonth ? "、翌月払い" : "、当月払い"})
          </span>
        </div>
        {!review.allPosted && <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">まだ計上していない月があります。その月はシフト・打刻からの見込みで計算しています。</p>}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        <div className="hidden px-1 pb-2 print:block">
          <p className="text-lg font-semibold">算定基礎の計算表({review.year}年)</p>
          <p className="text-sm">{company.name}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">氏名</th>
                <th className="px-3 py-2 text-right">今の標準報酬</th>
                {review.paidMonths.map((p) => (
                  <th key={p.label} className="px-3 py-2 text-right">
                    {p.label}支払
                    <span className="block font-normal">日数・報酬</span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right">平均</th>
                <th className="px-3 py-2 text-right">
                  新しい標準報酬
                  <span className="block font-normal">健康保険・厚生年金</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {review.rows.map((r) => (
                <tr key={r.staffId}>
                  <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {r.current === null ? <span className="text-slate-400">未設定</span> : thousand(r.current)}
                    {r.currentGrade !== null && <span className="block text-xs text-slate-500">{r.currentGrade}等級</span>}
                  </td>
                  {r.months.map((m) => (
                    <td key={m.label} className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${m.counted ? "" : "text-slate-400"}`}>
                      {m.days}日
                      <span className="block">{yen(m.pay)}</span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {yen(r.average)}
                    <span className="block text-xs text-slate-500">{r.rule === "SHORT" ? "15日以上の月で計算" : r.rule === "NONE" ? "日数が足りない" : ""}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {r.next === null ? (
                      <span className="text-slate-500">今のまま</span>
                    ) : (
                      <>
                        <span className={r.gradeDiff !== null && Math.abs(r.gradeDiff) > 0 ? "font-semibold" : ""}>{thousand(r.next)}</span>
                        {r.pension !== r.next && <span className="block text-xs text-slate-500">厚生年金 {thousand(r.pension)}</span>}
                        <span className="block text-xs text-slate-500">
                          {r.nextGrade}等級
                          {r.gradeDiff !== null && r.gradeDiff !== 0 && <span className={r.gradeDiff > 0 ? "text-rose-700" : "text-emerald-700"}>({r.gradeDiff > 0 ? `${r.gradeDiff}等級上がる` : `${-r.gradeDiff}等級下がる`})</span>}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {review.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    社会保険に加入しているスタッフがいません(給与計算の「スタッフごとの設定」で加入を選べます)。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ReviewActions year={review.year} changing={changing.map((r) => ({ staffId: r.staffId, name: r.name, current: r.current, next: r.next! }))} applied={review.applied} />

      <div className="space-y-1 text-xs text-slate-500 print:hidden">
        <p>・支払基礎日数が17日以上の月で平均します。どの月も17日に満たない人(パート・アルバイトなど)は15日以上の月で平均します(特定適用事業所の短時間労働者は11日以上など、扱いが違うことがあります)。</p>
        <p>・グレーの月は平均に入れていません。どの月も日数が足りない人は、今の標準報酬月額のまま(保険者が決めます)です。</p>
        <p>・6月1日以降に入社した人や、7〜9月に月額変更(随時改定)をする人は算定基礎の対象外です。届出は日本年金機構の電子申請や「届書作成プログラム」で出せます。</p>
      </div>
    </div>
  );
}
