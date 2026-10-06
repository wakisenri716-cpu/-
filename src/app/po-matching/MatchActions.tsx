"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MatchActions({ kind, orderId, invoiceId, label }: { kind: string; orderId: string | null; invoiceId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function post(payload: Record<string, unknown>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    const res = await fetch("/api/po-matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!res.ok) return window.alert((await res.json().catch(() => ({}))).error || "できませんでした");
    router.refresh();
  }
  return (
    <span className="flex flex-wrap gap-2">
      {(kind === "MATCH" || kind === "MISMATCH") && orderId && (
        <button
          disabled={busy}
          onClick={() => post({ action: "link", orderId, invoiceId }, kind === "MATCH" ? `${label} で発注書を検収済みにします。よろしいですか?` : `金額が違いますが、${label} で発注書を検収済みにします。差額は確かめましたか?`)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${kind === "MATCH" ? "bg-vermilion-600 text-white hover:bg-vermilion-700" : "border border-amber-500 text-amber-800 hover:bg-amber-50"}`}
        >
          {kind === "MATCH" ? "この請求書で検収する" : "差額を確かめて検収する"}
        </button>
      )}
      {kind === "DOUBLE" && (
        <button disabled={busy} onClick={() => post({ action: "cancel", invoiceId }, `取り込んだ ${label} を取り消します(仕訳も取消)。よろしいですか?`)} className="rounded-md border border-rose-400 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
          取り込んだ請求書を取り消す
        </button>
      )}
    </span>
  );
}
