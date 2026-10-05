"use client";

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";

type Review = { summary: string; priorities: { text: string; href: string }[]; mode: string; score: number; createdAt: string | Date };

export function ReviewPanel({ initial }: { initial: Review | null }) {
  const [review, setReview] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/book-check", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "まとめられませんでした");
    setReview(json.review);
  }
  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
          <SparkleIcon className="h-4 w-4" />
          AIの所見
        </h2>
        <button onClick={run} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "AIが読んでいます…" : review ? "もう一度まとめる" : "どこから直すかAIにまとめてもらう"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      {review ? (
        <div className="mt-2">
          <p className="text-sm">{review.summary}</p>
          {review.priorities.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {review.priorities.map((p, i) => (
                <li key={i}>
                  <Link href={p.href} className="hover:underline">
                    {p.text}
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-xs text-slate-500">{review.mode === "claude" ? "AIがまとめました" : "決まったルールでまとめました"}。最終的な判断は税理士に相談してください。</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">下の点検結果を読んで、税金や決算への影響が大きい順に、どこから直すかをまとめます。</p>
      )}
    </section>
  );
}
