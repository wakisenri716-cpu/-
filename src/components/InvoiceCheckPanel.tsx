"use client";

import { useState } from "react";
import Link from "next/link";
import type { CheckLevel, InvoiceIssue } from "@/lib/invoiceCheck";

const LEVEL: Record<CheckLevel, { label: string; className: string }> = {
  error: { label: "直してください", className: "text-rose-800" },
  warn: { label: "確かめてください", className: "text-amber-900" },
  info: { label: "参考", className: "text-slate-700" },
};

export function InvoiceCheckPanel({ id, issues, ai }: { id: string; issues: InvoiceIssue[]; ai: boolean }) {
  const [aiPoints, setAiPoints] = useState<InvoiceIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(issues.some((i) => i.level !== "info"));

  async function review() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/check`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setAiPoints(data.points);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.filter((i) => i.level === "warn").length;
  const tone = errors ? "border-rose-200 bg-rose-50/60" : warns ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60";
  return (
    <section className={`space-y-2 rounded-xl border p-4 text-sm print:hidden ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">送る前のチェック</h2>
        <span className="text-xs text-slate-600">{errors || warns ? `直してください ${errors}件・確かめてください ${warns}件` : "大きな問題は見つかりませんでした"}</span>
        <span className="ml-auto flex gap-2">
          {ai && (
            <button onClick={review} disabled={busy} className="rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
              {busy ? "AIが読んでいます…" : "AIでも見る(品名・備考)"}
            </button>
          )}
          {issues.length > 0 && (
            <button onClick={() => setOpen(!open)} className="text-xs text-slate-600 underline">
              {open ? "閉じる" : `${issues.length}件を見る`}
            </button>
          )}
        </span>
      </div>
      {open && (
        <ul className="space-y-1">
          {issues.map((i, n) => (
            <li key={n} className={LEVEL[i.level].className}>
              <span className="mr-1 rounded bg-white/80 px-1.5 py-0.5 text-xs">{LEVEL[i.level].label}</span>
              {i.message}
              {i.fix && (i.href ? <Link href={i.href} className="ml-1 text-xs text-indigo-700 underline">{i.fix}</Link> : <span className="ml-1 text-xs">({i.fix})</span>)}
              {!i.fix && i.href && <Link href={i.href} className="ml-1 text-xs text-indigo-700 underline">開く</Link>}
            </li>
          ))}
        </ul>
      )}
      {aiPoints && (
        <div className="border-t border-slate-200 pt-2">
          <p className="text-xs font-medium text-indigo-800">AIの見直し(品名・備考)</p>
          {aiPoints.length ? (
            <ul className="mt-1 space-y-1 text-slate-800">
              {aiPoints.map((p, n) => (
                <li key={n}>・{p.message}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-slate-600">気になる書き方は見つかりませんでした。</p>
          )}
        </div>
      )}
      {error && <p className="text-rose-800">{error}</p>}
    </section>
  );
}
