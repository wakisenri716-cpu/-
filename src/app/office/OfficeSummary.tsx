"use client";

import { useState } from "react";

export default function OfficeSummary({ initial, ai }: { initial: string; ai: boolean }) {
  const [summary, setSummary] = useState(initial);
  const [mode, setMode] = useState("template");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ask() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/office/summary", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "まとめられませんでした");
    setSummary(json.summary);
    setMode(json.mode);
  }
  return (
    <section className="flex flex-wrap items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm shadow-sm">
      <p className="min-w-0 flex-1 leading-relaxed text-slate-800">
        <span className="mr-2 rounded-full bg-white px-2 py-0.5 text-xs text-indigo-700 ring-1 ring-indigo-200">{mode === "claude" ? "AIのまとめ" : "まとめ"}</span>
        {summary}
      </p>
      {ai && (
        <button onClick={ask} disabled={busy} className="shrink-0 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          {busy ? "AIがまとめています…" : "AIでまとめる"}
        </button>
      )}
      {error && <p className="w-full text-rose-700">{error}</p>}
    </section>
  );
}
