"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 承認・差戻し・取下げ・コメント
export function RequestActions({ id, canDecide, canWithdraw }: { id: string; canDecide: boolean; canWithdraw: boolean }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject" | "withdraw" | "comment") {
    if (action === "withdraw" && !confirm("この申請を取り下げますか?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "処理できませんでした");
      setComment("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <label className="block text-sm">
        <span className="text-slate-600">{canDecide ? "コメント(差し戻すときは理由を書いてください)" : "コメント"}</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        {canDecide && (
          <>
            <button onClick={() => act("approve")} disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              承認する
            </button>
            <button onClick={() => act("reject")} disabled={busy || !comment.trim()} className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
              差し戻す
            </button>
          </>
        )}
        <button onClick={() => act("comment")} disabled={busy || !comment.trim()} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          コメントだけ残す
        </button>
        {canWithdraw && (
          <button onClick={() => act("withdraw")} disabled={busy} className="ml-auto text-sm text-slate-500 hover:text-rose-700 hover:underline disabled:opacity-50">
            申請を取り下げる
          </button>
        )}
      </div>
    </div>
  );
}
