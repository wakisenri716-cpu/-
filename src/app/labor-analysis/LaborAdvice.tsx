"use client";

import { useState } from "react";

export default function LaborAdvice({ month }: { month: string }) {
  const [advice, setAdvice] = useState<{ summary: string; points: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/labor-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setAdvice(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={ask} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
        {busy ? "AIが見ています…" : "AIに見立てを聞く"}
      </button>
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {advice && (
        <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p>{advice.summary}</p>
          {advice.points.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {advice.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
