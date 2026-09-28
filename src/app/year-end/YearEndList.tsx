"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatYen } from "@/lib/format";
import type { YearEndResult } from "@/lib/payroll/yearEndTax";

type Row = {
  staffId: string;
  name: string;
  paid: { pay: number; social: number; tax: number; payrollCount: number; bonusCount: number };
  reason: string | null;
  status: "excluded" | "finalized" | "entered" | "empty";
  result: YearEndResult | null;
};
type Data = {
  year: number;
  months: { from: string; to: string; salaryPaidNextMonth: boolean };
  rows: Row[];
  summary: { count: number; finalized: number; refund: number; collect: number };
};

const STATUS: Record<Row["status"], [string, string]> = {
  empty: ["申告を入力していない", "bg-amber-50 text-amber-800"],
  entered: ["入力済み(未確定)", "bg-sky-50 text-sky-800"],
  finalized: ["確定", "bg-emerald-50 text-emerald-800"],
  excluded: ["対象外", "bg-slate-100 text-slate-600"],
};
const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月分`;
const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

export function YearEndList({ year }: { year: number }) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetch(`/api/year-end?year=${year}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => {});
  }, [year]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">年末調整・源泉徴収票</h1>
          <p className="mt-1 text-sm text-slate-600">
            その年に支払った給料・賞与と、本人から出してもらった扶養控除等申告書・保険料控除申告書などの内容から、1年分の所得税(年税額)を計算し、払いすぎ・足りない分(過不足)を出します。確定すると源泉徴収票を印刷できます。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/year-end?year=${year - 1}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            ← {year - 1}年
          </Link>
          <Link href={`/year-end?year=${year + 1}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            {year + 1}年 →
          </Link>
        </div>
      </div>

      <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
        計算は令和7年(2025年)分の税制改正(給与所得控除の最低額65万円・基礎控除の引上げ)に合わせた<strong>目安</strong>です。障害者控除・ひとり親控除などは「その他の控除」に金額で入れてください。税制が変わった年や判断に迷うときは、国税庁の「年末調整のしかた」や税理士に確かめてから、給料で精算してください。
      </div>

      {data && (
        <>
          <p className="text-sm font-medium text-slate-800">
            {data.year}年の支払: 給料 {ym(data.months.from)}〜{ym(data.months.to)}
            {data.months.salaryPaidNextMonth ? "(翌月払い)" : ""}・{data.year}年に支払った賞与
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "対象の人", value: `${data.summary.count}人` },
              { label: "確定した人", value: `${data.summary.finalized}人` },
              { label: "還付する合計(払いすぎ)", value: formatYen(data.summary.refund) },
              { label: "追加で徴収する合計", value: formatYen(data.summary.collect) },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">{t.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">名前</th>
                    <th className="px-3 py-2 text-right font-medium">支払金額</th>
                    <th className="px-3 py-2 text-right font-medium">社会保険料</th>
                    <th className="px-3 py-2 text-right font-medium">徴収した税額</th>
                    <th className="px-3 py-2 text-right font-medium">年税額</th>
                    <th className="px-3 py-2 text-right font-medium">過不足</th>
                    <th className="px-3 py-2 text-left font-medium">状態</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.rows.map((r) => (
                    <tr key={r.staffId}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-slate-500">
                          給料{r.paid.payrollCount}回{r.paid.bonusCount ? `・賞与${r.paid.bonusCount}回` : ""}
                        </span>
                      </td>
                      <td className={cell}>{formatYen(r.paid.pay)}</td>
                      <td className={cell}>{formatYen(r.paid.social)}</td>
                      <td className={cell}>{formatYen(r.paid.tax)}</td>
                      <td className={cell}>{r.result ? formatYen(r.result.annualTax) : "-"}</td>
                      <td className={`${cell} font-semibold`}>
                        {!r.result ? (
                          "-"
                        ) : r.result.difference >= 0 ? (
                          <span className="text-emerald-700">還付 {formatYen(r.result.difference)}</span>
                        ) : (
                          <span className="text-rose-700">徴収 {formatYen(-r.result.difference)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                        {r.reason && <span className="block text-xs text-slate-500">{r.reason}</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                        {r.status !== "excluded" && (
                          <Link href={`/year-end/${r.staffId}?year=${data.year}`} className="mr-3 font-medium text-indigo-700 hover:underline">
                            {r.status === "finalized" ? "内容を見る" : "申告を入力"}
                          </Link>
                        )}
                        <Link href={`/year-end/slips?year=${data.year}&staff=${r.staffId}`} className="text-slate-600 hover:underline">
                          源泉徴収票
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                        {data.year}年に支払った給料・賞与がありません。給与計算で給料を計上すると、ここに出ます。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {data.rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <p className="text-slate-600">
                過不足は、ふつう12月(翌月払いなら1月)に払う給料で精算します。還付は給料に上乗せし、徴収は給料から差し引きます。源泉徴収票は本人に渡し、1月31日までに市区町村へ給与支払報告書を出します。
              </p>
              <Link href={`/year-end/slips?year=${data.year}`} className="rounded-md bg-indigo-600 px-4 py-2 font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700">
                源泉徴収票をまとめて印刷
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
