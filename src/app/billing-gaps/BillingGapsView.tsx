"use client";

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

type Gap = { key: string; kind: "MONTHLY" | "DEAL" | "QUOTE"; level: "warn" | "info"; customer: string; title: string; detail: string; amount: number | null; href: string; hrefLabel: string; aiNote: string | null };
type Data = { today: string; gaps: Gap[]; review: { summary: string; mode: string; createdAt: string; createdBy: string } | null };

const KIND = { MONTHLY: "毎月の請求", DEAL: "受注した商談", QUOTE: "見積" };
const DISMISS = { MONTHLY: "今月は請求しない", DEAL: "請求済み・請求しない", QUOTE: "対応済み" };

export function BillingGapsView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function post(body: object, tag: string) {
    setBusy(tag);
    setError(null);
    const res = await fetch("/api/billing-gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(json.error || "できませんでした");
    setData(json);
  }
  const total = data.gaps.reduce((s, g) => s + (g.amount ?? 0), 0);
  return (
    <>
      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの見立て
          </h2>
          <button onClick={() => post({ action: "review" }, "review")} disabled={!!busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy === "review" ? "AIが読んでいます…" : data.review ? "もう一度AIに見てもらう" : "AIに見てもらう"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        {data.review ? (
          <>
            <p className="mt-2 text-sm">{data.review.summary}</p>
            <p className="mt-1 text-xs text-slate-500">
              {data.review.mode === "claude" ? "AIが見立てました" : "決まったルールでまとめました"}({new Date(data.review.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{data.review.createdBy})
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">それぞれの項目について、何を確かめて次にどうするかをAIが一言ずつ書きます。</p>
        )}
      </section>

      {data.gaps.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">請求漏れは見つかりませんでした。</div>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            出し忘れかもしれない請求が <b>{data.gaps.length}件</b>(税抜 {formatYen(total)} ほど)あります。
          </p>
          <ul className="space-y-3">
            {data.gaps.map((g) => (
              <li key={g.key} className={`rounded-xl border bg-white p-4 shadow-sm ${g.level === "warn" ? "border-rose-200" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="flex min-w-0 items-start gap-2 font-medium">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${g.level === "warn" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-800"}`}>{KIND[g.kind]}</span>
                    <span className="break-words">{g.title}</span>
                  </h2>
                  {g.amount !== null && <span className="shrink-0 font-semibold tabular-nums">{formatYen(g.amount)}</span>}
                </div>
                <p className="mt-1 text-sm text-slate-600">{g.detail}</p>
                {g.aiNote && (
                  <p className="mt-1 flex items-start gap-1 text-sm text-indigo-800">
                    <SparkleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {g.aiNote}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={g.href} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                    {g.hrefLabel}
                  </Link>
                  <button onClick={() => post({ action: "dismiss", key: g.key }, g.key)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {DISMISS[g.kind]}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
