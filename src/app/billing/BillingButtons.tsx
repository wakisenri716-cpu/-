"use client";

import { useState } from "react";

// Stripe の画面(申し込み・お支払い情報の管理)へ移る
export function BillingButton({ action, plan, aiMode, label, primary = true }: { action: "checkout" | "portal"; plan?: string; aiMode?: "INCLUDED" | "BYO"; label: string; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/billing/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, aiMode }) });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.url) {
      window.location.assign(json.url);
      return;
    }
    setBusy(false);
    setError(json.error || "画面を開けませんでした");
  }

  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className={`w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${primary ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
      >
        {busy ? "開いています..." : label}
      </button>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
