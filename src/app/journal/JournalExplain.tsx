"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Explanation = {
  kind: string | null;
  lines: { side: string; account: string; amount: number; meaning: string }[];
  profitEffect: number;
  cashEffect: number;
  effects: string[];
  story: string;
  points: string[];
  cautions: string[];
  mode: "claude" | "template";
};

const tone = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-600");
const signed = (v: number) => (v === 0 ? "±0" : `${v > 0 ? "+" : "-"}${formatYen(Math.abs(v))}`);

// 「この仕訳は何?」の説明(仕訳帳の行の下に開く)
export function JournalExplain({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/journal/${entryId}/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }) });
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) setError(body.error || "説明を作れませんでした");
      else setData(body);
    },
    [entryId],
  );

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // 表が横に長いスマホでも、画面の幅に収めて左に留める
  return (
    <div className="sticky left-4 max-w-[calc(100vw-4.5rem)] rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm whitespace-normal">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-indigo-700">この仕訳は何?{data && (data.mode === "claude" ? "(AIの説明)" : "(決まったルールでの説明)")}</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">
          閉じる
        </button>
      </div>
      {!data && !error && <p className="mt-2 text-slate-500">説明を作っています...</p>}
      {error && <p className="mt-2 text-rose-700">{error}</p>}
      {data && (
        <div className="mt-2 space-y-3">
          <p className="leading-relaxed text-slate-800">{data.story}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 ${tone(data.profitEffect)}`}>利益 {signed(data.profitEffect)}</span>
            <span className={`rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 ${tone(data.cashEffect)}`}>現金・預金 {signed(data.cashEffect)}</span>
            {data.kind && <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-800">{data.kind}</span>}
          </div>
          <ul className="space-y-1">
            {data.lines.map((l, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-slate-700">
                <span className={`w-10 shrink-0 text-xs font-medium ${l.side === "借方" ? "text-sky-700" : "text-orange-700"}`}>{l.side}</span>
                <span className="tabular-nums">{formatYen(l.amount)}</span>
                <span>… {l.meaning}</span>
              </li>
            ))}
          </ul>
          {data.points.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-600">ポイント</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
                {data.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {data.cautions.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              <p className="text-xs font-medium">確かめた方がよいこと</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {data.cautions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {data.mode === "template" && (
            <button type="button" disabled={busy} onClick={() => load(true)} className="text-xs text-indigo-700 hover:underline disabled:opacity-50">
              {busy ? "説明を作っています..." : "AIにくわしく説明してもらう"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
