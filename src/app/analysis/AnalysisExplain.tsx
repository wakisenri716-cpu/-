"use client";

import { useState } from "react";
import { SparkleIcon } from "@/components/icons";

type Explanation = { summary: string[]; strengths: string[]; concerns: { text: string; action: string }[]; mode: "claude" | "template" };

// 経営分析の数字を、社長向けにやさしく説明する(AIが使えないときは決まったルールの説明)
export function AnalysisExplain({ from, to, ai }: { from: string; to: string; ai: boolean }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm break-inside-avoid">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <SparkleIcon className="h-4 w-4 text-indigo-600" />
          この数字が言っていること
        </h2>
        <button onClick={load} disabled={busy} className="ml-auto rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 print:hidden">
          {busy ? "まとめています…" : data ? "もう一度まとめる" : ai ? "AIにやさしく説明してもらう" : "やさしく説明する"}
        </button>
      </div>
      {!data && !error && <p className="mt-2 text-sm text-slate-500">指標の意味と、良いところ・気をつけるところ、次にやることを、社長向けの言葉でまとめます。</p>}
      {error && <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {data && (
        <div className="mt-3 space-y-4 text-sm">
          <ul className="space-y-1">
            {data.summary.map((s) => (
              <li key={s} className="text-slate-800">
                {s}
              </li>
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-emerald-800">良いところ</h3>
              {data.strengths.length ? (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                  {data.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-500">とくにありません。</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold text-amber-800">気をつけるところ</h3>
              {data.concerns.length ? (
                <ul className="mt-1 space-y-2 text-slate-700">
                  {data.concerns.map((c) => (
                    <li key={c.text}>
                      {c.text}
                      {c.action && <span className="mt-0.5 block text-xs text-slate-600">→ {c.action}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-500">とくにありません。</p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">{data.mode === "claude" ? "AIが数字をもとにまとめました。" : "決まったルールでまとめました。"}目安は一般的な水準です。判断に迷うときは税理士に相談してください。</p>
        </div>
      )}
    </section>
  );
}
