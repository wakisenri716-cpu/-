"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { fresh: { label: string; headline: string }[]; notified: boolean; mailed: number; pushed: number };

export function CheckNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/ai-watch", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "確かめられませんでした");
    setResult(json);
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <button onClick={run} disabled={busy} className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
        {busy ? "確かめています…" : "今すぐ確かめて知らせる"}
      </button>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {result && (
        <p className="text-xs text-slate-600">
          {result.fresh.length
            ? `新しく要確認になったもの: ${result.fresh.map((f) => f.label).join("・")}。${result.notified ? `管理者にメール ${result.mailed}件・スマホ ${result.pushed}件 で知らせました。` : "(知らせる設定はオフです)"}`
            : "前に確かめたときから、新しく要確認になったものはありません。"}
        </p>
      )}
    </div>
  );
}
