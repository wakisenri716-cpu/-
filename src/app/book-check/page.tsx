import Link from "next/link";
import type { ComponentProps } from "react";
import { requireCompanyId } from "@/lib/auth/session";
import { getBookCheckReview, runBookCheck } from "@/lib/bookCheck";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { ReviewPanel } from "./ReviewPanel";

export const dynamic = "force-dynamic";

// 帳簿の健康診断(今期の帳簿を、税理士に渡す前に点検する)
export default async function BookCheckPage() {
  const companyId = await requireCompanyId();
  const r = await runBookCheck(companyId);
  const review = await getBookCheckReview(companyId, r.period);
  const tone = r.score >= 90 ? "text-emerald-700" : r.score >= 70 ? "text-amber-700" : "text-rose-700";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">帳簿の健康診断</h1>
          <p className="mt-1 text-sm text-slate-600">今期({r.periodLabel})の帳簿を、税理士に渡す前に点検します。固定資産にすべき消耗品、金額の大きい雑費、マイナスの残高、残ったままの仮払金、私用に見える支出、二重計上などを探します。</p>
        </div>
        <PrintButton variant="outline" />
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs text-slate-500">点数</div>
          <div className={`text-3xl font-bold tabular-nums ${tone}`}>
            {r.score}
            <span className="text-base font-medium text-slate-500"> / 100</span>
          </div>
        </div>
        <div className="text-sm text-slate-600">
          仕訳 {r.entryCount}件 を点検しました。要注意 {r.findings.filter((f) => f.level === "warn").length}件・参考 {r.findings.filter((f) => f.level === "info").length}件。
        </div>
      </div>

      <ReviewPanel initial={review ? ({ ...review, createdAt: review.createdAt.toISOString() } as unknown as ComponentProps<typeof ReviewPanel>["initial"]) : null} />

      {r.findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">決まったルールで見る限り、気になるところは見つかりませんでした。</div>
      ) : (
        <ul className="space-y-3">
          {r.findings.map((f) => (
            <li key={f.key} className={`rounded-xl border bg-white p-4 shadow-sm ${f.level === "warn" ? "border-rose-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="flex items-start gap-2 font-medium">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${f.level === "warn" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-800"}`}>{f.level === "warn" ? "要注意" : "参考"}</span>
                  {f.title}
                </h2>
                <Link href={f.href} className="text-sm text-indigo-700 hover:underline print:hidden">
                  確かめる →
                </Link>
              </div>
              <p className="mt-1 text-sm text-slate-600">{f.detail}</p>
              {f.examples.length > 0 && (
                <ul className="mt-2 divide-y rounded-md border text-sm">
                  {f.examples.map((e, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0">
                        <span className="mr-2 text-xs text-slate-500 tabular-nums">{e.date}</span>
                        <span className="break-words">{e.description}</span>
                      </span>
                      <span className={`shrink-0 tabular-nums ${e.amount < 0 ? "text-rose-700" : ""}`}>{formatYen(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
