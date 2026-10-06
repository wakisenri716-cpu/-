"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdviseButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/customer-insights", { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "提案を作れませんでした");
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button onClick={run} disabled={busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
        {busy ? "AIが考えています…" : label}
      </button>
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </span>
  );
}
