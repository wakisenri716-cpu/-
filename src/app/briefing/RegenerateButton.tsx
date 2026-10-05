"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegenerateButton({ exists }: { exists: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "作れませんでした");
    router.push("/briefing");
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button disabled={busy} onClick={run} className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${exists ? "border border-indigo-600 text-indigo-700 hover:bg-indigo-50" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
        {busy ? "AIがまとめています…" : exists ? "いまの状況で作り直す" : "今日のまとめを作る"}
      </button>
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </span>
  );
}
