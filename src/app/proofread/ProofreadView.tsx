"use client";

import { useState } from "react";
import type { CheckResult, IssueLevel } from "@/lib/textCheck";

const LEVEL: Record<IssueLevel, { label: string; className: string }> = {
  error: { label: "直してください", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  warn: { label: "見直しを", className: "bg-amber-50 text-amber-900 ring-amber-200" },
  info: { label: "参考", className: "bg-slate-50 text-slate-700 ring-slate-200" },
};

export default function ProofreadView({ ai }: { ai: boolean }) {
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<"rule" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function check(useAi: boolean) {
    setBusy(useAi ? "ai" : "rule");
    setError(null);
    try {
      const res = await fetch("/api/proofread", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, purpose, useAi }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setResult(data);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。文章を選んでコピーしてください");
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  const counts = result ? (["error", "warn", "info"] as IssueLevel[]).map((l) => [l, result.issues.filter((i) => i.level === l).length] as const) : [];
  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label className="block text-sm">
          <span className="text-slate-700">確かめたい文章</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={"株式会社さくら商事 御中 山田様\n\nいつもお世話になっております。\n先日おっしゃられていた件、10月9日(木)にお伺いさせていただきます。"} className={input} />
          <span className="mt-1 block text-right text-xs text-slate-500">{text.length.toLocaleString()} / 8,000文字</span>
        </label>
        {ai && (
          <label className="block text-sm">
            <span className="text-slate-700">どんな文章か(任意・AIに伝えます)</span>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 取引先への値上げのお願い。ていねいに、でも遠回しすぎないように" className={input} />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => check(false)} disabled={!!busy || !text.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "rule" ? "確かめています…" : "チェックする"}
          </button>
          {ai && (
            <button onClick={() => check(true)} disabled={!!busy || !text.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが読んでいます…" : "AIでも見る"}
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      {result && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {result.issues.length === 0 ? (
              <p className="rounded-md bg-emerald-50 px-4 py-2 text-emerald-800">気になる所は見つかりませんでした{result.mode === "template" && ai ? "(言い回しまで見るときは「AIでも見る」を)" : ""}。</p>
            ) : (
              counts
                .filter(([, n]) => n > 0)
                .map(([l, n]) => (
                  <span key={l} className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${LEVEL[l].className}`}>
                    {LEVEL[l].label} {n}
                  </span>
                ))
            )}
          </div>
          {result.note && <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">{result.note}</p>}
          <ul className="space-y-2">
            {result.issues.map((i, n) => (
              <li key={n} className={`rounded-lg px-4 py-3 text-sm ring-1 ${LEVEL[i.level].className}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium">{i.kind}</span>
                  <span className="font-medium">{i.message}</span>
                </div>
                <p className="mt-1 text-xs opacity-80">「{i.excerpt}」</p>
                {i.suggestion && <p className="mt-1 text-xs">→ {i.suggestion}</p>}
              </li>
            ))}
          </ul>
          {result.revised && (
            <div className="space-y-2 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-indigo-800">AIが直した全文(数字・名前はそのまま)</p>
                <div className="flex gap-2">
                  <button onClick={() => copy(result.revised!)} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50">
                    {copied ? "コピーしました" : "コピー"}
                  </button>
                  <button onClick={() => setText(result.revised!)} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50">
                    上の欄に入れる
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{result.revised}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
