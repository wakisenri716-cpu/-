"use client";

import { useState, type FormEvent } from "react";

// マスタのCSV一括登録フォーム(取引先・顧客、商品などで共通)
export function CsvImportForm({ endpoint, title, hint, onDone }: { endpoint: string; title: string; hint: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage(null);
    const res = await fetch(endpoint, { method: "POST", body: new FormData(form) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "登録できませんでした" });
    form.reset();
    setMessage({ ok: true, text: `追加 ${body.created}件・更新 ${body.updated}件${body.skipped ? `・変更なし ${body.skipped}件` : ""}` });
    onDone?.();
  }

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">{title}</summary>
      <p className="mt-2 text-xs text-slate-500">
        {hint}
        <a href={endpoint} className="ml-1 text-indigo-700 hover:underline">
          サンプルCSV
        </a>
      </p>
      {message && (
        <div className={`mt-2 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <button type="submit" disabled={busy} className="rounded-md border border-indigo-600 px-4 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
          {busy ? "登録中..." : "登録する"}
        </button>
      </form>
    </details>
  );
}
