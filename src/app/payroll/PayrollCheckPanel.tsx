"use client";

import { useEffect, useState } from "react";
import { SparkleIcon } from "@/components/icons";

type Point = { level: "warn" | "info"; staff: string | null; text: string };
type Review = { data: { ready: boolean; summary: string; steps: string[] }; mode: string };

// 給料を計上する前のチェック(給与計算の画面に出す)
export function PayrollCheckPanel({ month, refreshKey }: { month: string; refreshKey: number }) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/payroll/check?month=${month}`);
      const json = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok) return setError(json.error || "チェックできませんでした");
      setError(null);
      setPoints(json.check.points);
      setReview(json.review);
    })();
    return () => {
      alive = false;
    };
  }, [month, refreshKey]);

  async function ask() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/payroll/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "見立てを作れませんでした");
    setReview(json.review);
  }

  if (!points) return null;
  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
          <SparkleIcon className="h-4 w-4" />
          計上前のチェック
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${points.some((p) => p.level === "warn") ? "bg-rose-100 text-rose-700" : points.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {points.some((p) => p.level === "warn") ? `要確認 ${points.filter((p) => p.level === "warn").length}件` : points.length ? `参考 ${points.length}件` : "問題なし"}
          </span>
        </h2>
        {points.length > 0 && (
          <button onClick={ask} disabled={busy} className="rounded-md border border-indigo-600 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
            {busy ? "AIが確かめています…" : "計上してよいかAIに見立ててもらう"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      {points.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">打刻忘れ・大きな変化・残業の多さ・手取りのマイナスなど、決まったルールで見る限り気になるところはありません。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {points.map((p, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${p.level === "warn" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>{p.level === "warn" ? "!" : "i"}</span>
              <span className="min-w-0">
                {p.staff && <span className="font-medium">{p.staff}さん: </span>}
                {p.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {review && (
        <div className={`mt-3 rounded-lg p-3 ${review.data.ready ? "bg-emerald-50" : "bg-amber-50"}`}>
          <p className="text-sm font-medium">{review.data.summary}</p>
          {review.data.steps.length > 0 && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
              {review.data.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          <p className="mt-1 text-xs text-slate-500">{review.mode === "claude" ? "AIが見立てました" : "決まったルールで見立てました"}</p>
        </div>
      )}
    </section>
  );
}
