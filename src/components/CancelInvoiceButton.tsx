"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm("この請求書を取り消しますか?売上の仕訳も取り消されます。")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/cancel`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "取り消せませんでした");
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      <button onClick={cancel} disabled={busy} className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
        {busy ? "取消中..." : "取り消す"}
      </button>
    </span>
  );
}
