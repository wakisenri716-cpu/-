"use client";

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

type Row = {
  invoiceId: string;
  invoiceNumber: string | null;
  customer: string;
  remaining: number;
  dueDate: string | null;
  predictedDate: string;
  shiftDays: number;
  confidence: "high" | "medium" | "low";
  risk: boolean;
  basis: string;
  aiReason: string | null;
};
type Data = {
  today: string;
  rows: Row[];
  months: { month: string; due: number; predicted: number }[];
  total: number;
  later: number;
  risky: Row[];
  review: { summary: string; mode: string; createdAt: string; createdBy: string; fresh: boolean } | null;
};

const CONF = { high: { label: "高", cls: "bg-emerald-100 text-emerald-800" }, medium: { label: "中", cls: "bg-sky-100 text-sky-800" }, low: { label: "低", cls: "bg-slate-100 text-slate-700" } };
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : "-");
const monthLabel = (m: string) => `${Number(m.slice(5))}月`;

export function ReceiptForecastView({ initial }: { initial: Data }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function review() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/receipt-forecast", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "見直せませんでした");
    setF(json);
  }
  return (
    <>
      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの見直し
          </h2>
          <button onClick={review} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "AIが読んでいます…" : f.review ? "もう一度AIに見直してもらう" : "AIに見直してもらう"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        {f.review ? (
          <>
            <p className="mt-2 text-sm">{f.review.summary}</p>
            <p className="mt-1 text-xs text-slate-500">
              {f.review.mode === "claude" ? "AIが見直しました" : "決まったルールでまとめました"}({new Date(f.review.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{f.review.createdBy})
              {!f.review.fresh && "。2週間以上前の見直しなので、予測には使っていません"}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">払い方の変化・ばらつき・金額の大きさを読んで、予測より遅めに見ておくべき請求書をAIが選びます(早めることはしません)。</p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">入金待ち</div>
          <div className="text-xl font-semibold tabular-nums">{formatYen(f.total)}</div>
          <div className="text-xs text-slate-500">{f.rows.length}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">期日より遅れそう</div>
          <div className="text-xl font-semibold text-amber-700 tabular-nums">{formatYen(f.later)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">督促が必要</div>
          <div className={`text-xl font-semibold tabular-nums ${f.risky.length ? "text-rose-700" : ""}`}>{f.risky.length}件</div>
          {f.risky.length > 0 && (
            <Link href="/collections" className="text-xs text-indigo-700 hover:underline">
              督促・回収へ →
            </Link>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">月ごとの入金(期日どおり と 予測)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left" />
                {f.months.map((m) => (
                  <th key={m.month} className="px-4 py-2 text-right whitespace-nowrap">
                    {monthLabel(m.month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <th scope="row" className="px-4 py-2 text-left font-normal whitespace-nowrap">期日どおり</th>
                {f.months.map((m) => (
                  <td key={m.month} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{formatYen(m.due)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2 text-left font-medium whitespace-nowrap">予測</th>
                {f.months.map((m) => (
                  <td key={m.month} className={`px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap ${m.predicted < m.due ? "text-amber-700" : ""}`}>
                    {formatYen(m.predicted)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {f.rows.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">入金待ちの請求書はありません。</div>
      ) : (
        <ul className="space-y-2">
          {f.rows.map((r) => (
            <li key={r.invoiceId} className={`rounded-xl border bg-white p-3 shadow-sm ${r.risk ? "border-rose-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {r.customer}
                    <span className="ml-2 text-xs font-normal text-slate-500">{r.invoiceNumber ?? ""}</span>
                  </p>
                  <p className="text-sm text-slate-600">
                    期日 {md(r.dueDate)} → 予測 <b className={r.shiftDays > 0 ? "text-amber-700" : ""}>{md(r.predictedDate)}</b>
                    {r.shiftDays !== 0 && <span className="ml-1 text-xs">({r.shiftDays > 0 ? `${r.shiftDays}日遅れ` : `${-r.shiftDays}日早い`})</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.risk && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs whitespace-nowrap text-rose-700">督促が必要</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${CONF[r.confidence].cls}`}>確からしさ {CONF[r.confidence].label}</span>
                  <span className="font-semibold tabular-nums">{formatYen(r.remaining)}</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600">{r.basis}</p>
              {r.aiReason && (
                <p className="mt-1 flex items-start gap-1 text-xs text-indigo-800">
                  <SparkleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                  {r.aiReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
