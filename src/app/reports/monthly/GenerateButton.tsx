"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GenerateButton({ month, exists }: { month: string; exists: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/reports/monthly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "作れませんでした");
    router.push(`/reports/monthly?month=${json.month}`);
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button disabled={busy} onClick={run} className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${exists ? "border border-indigo-600 text-indigo-700 hover:bg-indigo-50" : "bg-vermilion-600 text-white hover:bg-vermilion-700"}`}>
        {busy ? "AIが書いています…" : exists ? "いまの数字で作り直す" : "レポートを作る"}
      </button>
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </span>
  );
}
