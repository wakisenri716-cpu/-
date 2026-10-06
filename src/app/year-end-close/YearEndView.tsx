"use client";

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";

type Item = { key: string; label: string; kind: "auto" | "manual"; done: boolean; detail: string | null; href: string; checkedBy?: string | null };
type Data = {
  fiscalYear: number;
  from: string;
  to: string;
  ended: boolean;
  deadlinePassed: boolean;
  daysToEnd: number;
  filingDeadline: string;
  items: Item[];
  left: number;
  total: number;
  review: { data: unknown; mode: string; createdAt: string | Date; createdBy: string } | null;
};

const ymd = (d: string) => d.replaceAll("-", "/");

export function YearEndView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function post(body: object, tag: string) {
    setBusy(tag);
    setError(null);
    const res = await fetch("/api/year-end-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, year: data.fiscalYear }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(json.error || "できませんでした");
    setData(json);
  }
  const review = data.review ? (data.review.data as { summary: string; steps: string[] }) : null;
  const pct = Math.round(((data.total - data.left) / data.total) * 100);
  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs text-slate-500">対象の年度</div>
          <div className="font-semibold">
            {ymd(data.from)}〜{ymd(data.to)}
          </div>
          <div className={`text-xs ${data.deadlinePassed && data.left ? "font-medium text-rose-700" : "text-slate-500"}`}>{data.ended ? `申告の期限(目安): ${ymd(data.filingDeadline)}${data.deadlinePassed ? "(過ぎています)" : ""}` : `期末まであと${data.daysToEnd}日`}</div>
        </div>
        <div className="min-w-40 flex-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>
              済み {data.total - data.left} / {data.total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/year-end-close?year=${data.fiscalYear - 1}`} className="text-indigo-700 hover:underline">
            ← 前の年度
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの段取り
          </h2>
          <button onClick={() => post({ action: "review" }, "review")} disabled={!!busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy === "review" ? "AIが読んでいます…" : review ? "もう一度まとめる" : "何から手を付けるかAIにまとめてもらう"}
          </button>
        </div>
        {review ? (
          <div className="mt-2">
            <p className="text-sm">{review.summary}</p>
            {review.steps.length > 0 && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {review.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-xs text-slate-500">{data.review?.mode === "claude" ? "AIがまとめました" : "決まったルールでまとめました"}。税金の判断は税理士に確かめてください。</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">残っている作業を、決算の手順に沿って何から手を付けるか順番にまとめます。</p>
        )}
      </section>
      {error && <p className="text-sm text-rose-700">{error}</p>}

      <ul className="space-y-2">
        {data.items.map((i) => (
          <li key={i.key} className={`flex items-start gap-3 rounded-xl border bg-white p-3 shadow-sm ${i.done ? "border-emerald-200" : "border-slate-200"}`}>
            {i.kind === "manual" ? (
              <input type="checkbox" checked={i.done} disabled={!!busy} onChange={(e) => post({ action: "check", key: i.key, checked: e.target.checked }, i.key)} className="mt-1 h-4 w-4" aria-label={i.label} />
            ) : (
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${i.done ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-400"}`}>{i.done ? "✓" : ""}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${i.done ? "text-slate-500" : "font-medium"}`}>{i.label}</p>
              {i.detail && <p className="mt-0.5 text-xs text-amber-800">{i.detail}</p>}
              {i.checkedBy && <p className="mt-0.5 text-xs text-slate-500">確認: {i.checkedBy}</p>}
              <p className="mt-0.5 text-xs text-slate-400">{i.kind === "auto" ? "帳簿から自動で確かめます" : "確かめたらチェックしてください"}</p>
            </div>
            <Link href={i.href} className="shrink-0 text-sm whitespace-nowrap text-indigo-700 hover:underline">
              開く →
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
