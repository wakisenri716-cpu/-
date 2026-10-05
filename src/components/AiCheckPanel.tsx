"use client";

import { useEffect, useRef, useState } from "react";
import { SparkleIcon } from "@/components/icons";

export type AiCheckView = {
  verdict: string;
  summary: string;
  points: { level: "warn" | "info" | "ok"; text: string; source: "rule" | "ai" }[];
  questions: string[];
  mode: string;
  createdAt: string | Date;
};

const VERDICT: Record<string, { label: string; className: string }> = {
  OK: { label: "気になる点なし", className: "bg-emerald-100 text-emerald-800" },
  CHECK: { label: "確かめたい点あり", className: "bg-amber-100 text-amber-800" },
  CAUTION: { label: "承認前に要確認", className: "bg-rose-100 text-rose-700" },
};
const MARK = { warn: { icon: "!", className: "bg-rose-100 text-rose-700" }, info: { icon: "i", className: "bg-sky-100 text-sky-700" }, ok: { icon: "✓", className: "bg-emerald-100 text-emerald-700" } };

// 承認前のAIチェック。auto なら、まだ結果がないときに開いた時点で一度だけ作る。
export function AiCheckPanel({ type, id, initial, auto }: { type: "REQUEST" | "EXPENSE"; id: string; initial: AiCheckView | null; auto: boolean }) {
  const [check, setCheck] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run(ifMissing: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/approval-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, id, ifMissing }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "チェックできませんでした");
    setCheck(json.check);
  }

  useEffect(() => {
    if (initial || !auto || started.current) return;
    started.current = true;
    run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = check ? (VERDICT[check.verdict] ?? VERDICT.CHECK) : null;
  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
          <SparkleIcon className="h-4 w-4" />
          承認前のAIチェック
          {v && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.className}`}>{v.label}</span>}
        </h2>
        <button onClick={() => run(false)} disabled={busy} className="rounded-md border border-indigo-600 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
          {busy ? "AIが確かめています…" : check ? "もう一度チェック" : "AIにチェックしてもらう"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      {!check && !error && <p className="mt-2 text-sm text-slate-500">{busy ? "申請の内容と過去の記録を確かめています…" : "重複・上限超え・領収書のない経費・初めての支払先などを確かめ、承認する前に見るとよい点をまとめます。"}</p>}
      {check && (
        <>
          <p className="mt-2 text-sm">{check.summary}</p>
          {check.points.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {check.points.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${MARK[p.level]?.className ?? MARK.info.className}`}>{MARK[p.level]?.icon ?? "i"}</span>
                  <span className="min-w-0">
                    {p.text}
                    {p.source === "ai" && <span className="ml-1 text-xs text-indigo-500">(AIの気づき)</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {check.questions.length > 0 && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <h3 className="text-xs font-semibold text-slate-500">申請者に聞くとよいこと</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {check.questions.map((q, i) => (
                  <li key={i} className="pl-4 -indent-4">
                    ・{q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            {check.mode === "claude" ? "AIとルールで確かめました" : "決まったルールで確かめました"}。承認するかどうかは内容を見て決めてください。
          </p>
        </>
      )}
    </section>
  );
}
