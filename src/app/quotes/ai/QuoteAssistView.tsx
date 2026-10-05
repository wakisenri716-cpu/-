"use client";

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

type History = { count: number; min: number; max: number; median: number; last: { date: string; customer: string; unitPrice: number; description: string } | null; sameCustomer: boolean };
type Line = { description: string; quantity: number; unit: string | null; unitPrice: number; taxRate: number; note: string | null; history: History | null; priceWarning: string | null };
type Draft = { draftId: string; customerName: string; lines: Line[]; subtotal: number; summary: string; mode: string };

const EXAMPLE = "ホームページ制作 トップページと下層5ページ、ロゴ作成、毎月の保守 3か月";

export function QuoteAssistView({ initialCustomer }: { initialCustomer: string }) {
  const [customerName, setCustomerName] = useState(initialCustomer);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/quotes/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerName, text }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "下書きを作れませんでした");
    setDraft(json);
  }
  return (
    <>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm">
          <span className="text-slate-600">見積先(任意)</span>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" placeholder="株式会社〇〇" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">見積の内容</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" placeholder={`例: ${EXAMPLE}`} />
        </label>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button onClick={run} disabled={busy || !text.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          <SparkleIcon className="h-4 w-4" />
          {busy ? "AIが明細を作っています…" : "明細の下書きを作る"}
        </button>
      </section>

      {draft && (
        <section className="space-y-3">
          <p className="flex items-start gap-1.5 text-sm text-indigo-900">
            <SparkleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {draft.summary}
            <span className="text-xs text-slate-500">({draft.mode === "claude" ? "AI" : "決まったルール"})</span>
          </p>
          <ul className="space-y-2">
            {draft.lines.map((l, i) => (
              <li key={i} className={`rounded-xl border bg-white p-3 shadow-sm ${l.priceWarning ? "border-amber-300" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 font-medium break-words">{l.description}</p>
                  <p className="shrink-0 text-sm tabular-nums">
                    {l.quantity}
                    {l.unit ?? ""} × {formatYen(l.unitPrice)}
                    {l.taxRate === 8 && <span className="ml-1 text-xs text-slate-500">(8%)</span>} = <b>{formatYen(Math.round(l.quantity * l.unitPrice))}</b>
                  </p>
                </div>
                {l.history && (
                  <p className="mt-1 text-xs text-slate-600">
                    過去の単価({l.history.sameCustomer ? "この顧客" : "ほかの顧客"}・{l.history.count}件): {formatYen(l.history.min)}〜{formatYen(l.history.max)}
                    {l.history.last && `(最近: ${l.history.last.date.replaceAll("-", "/")} ${l.history.last.description} ${formatYen(l.history.last.unitPrice)})`}
                  </p>
                )}
                {l.priceWarning && <p className="mt-1 text-xs font-medium text-amber-800">⚠ {l.priceWarning}</p>}
                {l.note && <p className="mt-1 text-xs text-indigo-800">{l.note}</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <span className="text-sm">
              小計(税抜) <b className="tabular-nums">{formatYen(draft.subtotal)}</b>
            </span>
            <Link href={`/quotes/new?draft=${draft.draftId}`} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              この明細で見積書を作る →
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
