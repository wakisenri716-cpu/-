"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function QuoteActions({ quoteId, status }: { quoteId: string; status: "OPEN" | "INVOICED" | "CANCELLED" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [issueDate, setIssueDate] = useState(() => dateKey(new Date()));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    return dateKey(new Date(d.getFullYear(), d.getMonth() + 2, 0));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/quotes/${quoteId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "処理に失敗しました");
      return null;
    }
    return data;
  }

  async function convert() {
    const invoice = await post("convert", { issueDate, dueDate });
    if (invoice) router.push(`/invoices/${invoice.id}/print`);
  }

  async function cancel() {
    if (!window.confirm("この見積書を取り消しますか?")) return;
    if (await post("cancel")) router.refresh();
  }

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={`/quotes/new?from=${quoteId}`} className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          複製して作成
        </Link>
        {status === "OPEN" && (
          <>
            <button onClick={cancel} disabled={busy} className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              取り消す
            </button>
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              請求書にする
            </button>
          </>
        )}
        {status !== "CANCELLED" && <PrintButton />}
      </div>
      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {open && status === "OPEN" && (
        <div className="flex flex-wrap items-end justify-end gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="w-full text-sm text-emerald-900">
            この見積書と同じ宛先・明細で請求書を作り、「売掛金 / 売上高・仮受消費税」の仕訳を記帳します。
          </p>
          <label className="text-xs text-slate-600">
            請求日
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1 block rounded-md border bg-white px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            お支払期限
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 block rounded-md border bg-white px-2 py-1.5 text-sm" />
          </label>
          <button onClick={convert} disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "作成中..." : "請求書を作成"}
          </button>
        </div>
      )}
    </div>
  );
}
