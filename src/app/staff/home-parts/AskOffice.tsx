"use client";

import Link from "next/link";
import { useState } from "react";

type Route = { key: string; label: string; href: string };

// ホームの「総務に頼む」: 書いたことから、どの画面で頼めばよいかを出す
export function AskOffice() {
  const [text, setText] = useState("");
  const [r, setR] = useState<(Route & { others: Route[]; mode: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/staff-app/route-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, useAi: true }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(json.error || "うまくいきませんでした");
    setR(json);
  }
  return (
    <section className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
      <h2 className="font-semibold">総務に頼む</h2>
      <div className="flex gap-2">
        <input aria-label="頼みたいこと" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && go()} placeholder="例: ボールペンを10本ほしい" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2" />
        <button onClick={go} disabled={busy || !text.trim()} className="shrink-0 rounded-xl bg-vermilion-600 px-3 py-2 font-medium text-white disabled:opacity-50">
          {busy ? "…" : "どこで頼む?"}
        </button>
      </div>
      {err && <p className="text-xs text-rose-700">{err}</p>}
      {r && (
        <div className="space-y-1.5">
          <Link href={r.key === "ask" ? `/staff/ask` : r.href} className="block rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 font-medium text-indigo-900">
            {r.label}で頼む ›
          </Link>
          {r.others.map((o) => (
            <Link key={o.key} href={o.href} className="block text-xs text-slate-600 underline">
              {o.label}のほうかも
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
