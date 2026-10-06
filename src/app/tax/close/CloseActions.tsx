"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatYen } from "@/lib/format";

export function CloseActions({ fy, canPost, posted, endMonth, empty }: { fy: number; canPost: boolean; posted: boolean; endMonth: number; empty: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(method: "POST" | "DELETE") {
    if (method === "POST" && posted && !confirm("前の決算整理の仕訳を取消にして、今の数字で作り直しますか?")) return;
    if (method === "DELETE" && !confirm(`${fy}年度の消費税の決算整理を取り消しますか?`)) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/tax/close${method === "DELETE" ? `?fy=${fy}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ fy }) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "できませんでした" });
    setMessage({
      ok: true,
      text: method === "POST" ? `決算整理の仕訳を作りました(${json.payable >= 0 ? `未払消費税等 ${formatYen(json.payable)}` : `未収消費税等 ${formatYen(-json.payable)}`})。` : "決算整理を取り消しました。",
    });
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2">
      {message && <div className={`rounded-md px-3 py-2 ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}
      <button disabled={busy || !canPost || empty} onClick={() => run("POST")} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
        {posted ? "今の数字で作り直す" : "期末の日付で決算整理の仕訳を作る"}
      </button>
      {!canPost && <p className="text-xs text-slate-500">期末の月({endMonth}月)になったら作れます。</p>}
      {posted && (
        <button disabled={busy} onClick={() => run("DELETE")} className="w-full rounded-md border border-rose-300 px-4 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
          決算整理を取り消す
        </button>
      )}
    </div>
  );
}
