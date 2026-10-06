"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

export type CashAdviceView = {
  date: string;
  risk: string;
  headline: string;
  actions: { title: string; detail: string; impact: number | null; href: string }[];
  mode: string;
};

const RISK: Record<string, { label: string; className: string; box: string }> = {
  LOW: { label: "余裕あり", className: "bg-emerald-100 text-emerald-800", box: "bg-emerald-50" },
  MEDIUM: { label: "注意", className: "bg-amber-100 text-amber-800", box: "bg-amber-50" },
  HIGH: { label: "危険", className: "bg-rose-100 text-rose-700", box: "bg-rose-50" },
};

// AIの資金繰りアドバイス(資金繰り予測の上に出す)
export function CashAdvicePanel({ initial, today }: { initial: CashAdviceView | null; today: string }) {
  const router = useRouter();
  const [advice, setAdvice] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/cashflow/advice", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "アドバイスを作れませんでした");
    setAdvice(json.advice);
    router.refresh();
  }

  const r = advice ? (RISK[advice.risk] ?? RISK.MEDIUM) : null;
  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
          <SparkleIcon className="h-4 w-4" />
          AIの資金繰りアドバイス
          {r && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.className}`}>{r.label}</span>}
        </h2>
        <button onClick={run} disabled={busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {busy ? "AIが考えています…" : advice?.date === today ? "いまの数字で作り直す" : "アドバイスをもらう"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      {!advice ? (
        <p className="mt-2 text-sm text-slate-500">この先3か月の資金の見込み・ふだんの支出・期限を過ぎた未入金・大きな支払を見て、AIが危険の大きさと効き目のある打ち手を出します。</p>
      ) : (
        <div className={`mt-3 rounded-lg p-3 ${r!.box}`}>
          <p className="text-sm font-medium">{advice.headline}</p>
          <ol className="mt-3 space-y-2">
            {advice.actions.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <Link href={a.href} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                    {a.impact !== null && a.impact > 0 && <span className="text-xs text-emerald-700 tabular-nums">効き目 {formatYen(a.impact)}</span>}
                  </span>
                  <span className="block text-xs text-slate-600">{a.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            {advice.date !== today && `${advice.date} の数字でのアドバイスです。`}
            {advice.mode === "claude" ? "AIが考えました" : "決まったルールで出しました"}。実際に動く前に、数字を確かめてください。
          </p>
        </div>
      )}
    </section>
  );
}
