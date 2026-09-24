"use client";

import { useState } from "react";

type Closing = { today: string; closedThrough: string | null; lastMonthEnd: string; lastFiscalYearEnd: string };

function jp(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

export function ClosingForm({ initial, canEdit }: { initial: Closing; canEdit: boolean }) {
  const [state, setState] = useState(initial);
  const [date, setDate] = useState(initial.lastMonthEnd);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(value: string | null) {
    const confirmText = value ? `${jp(value)}までの帳簿を締めますか?締めた期間の仕訳は追加・変更・取消できなくなります。` : "締めを解除しますか?";
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/closing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: value }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "処理に失敗しました" });
    setState(body);
    setMessage({ ok: true, text: value ? `${jp(value)}までの帳簿を締めました` : "締めを解除しました" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">締め処理</h1>
        <p className="mt-1 text-sm text-slate-600">
          月次・年次の決算が終わったら、その日までの帳簿を「締め」ます。締めた期間の仕訳は、どの画面からも追加・変更・取消ができなくなり、
          確定した数字がうっかり変わるのを防ぎます。
        </p>
      </div>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>
      )}

      <div className={`rounded-xl border p-5 shadow-sm ${state.closedThrough ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"}`}>
        <div className="text-xs text-slate-500">現在の状態</div>
        <div className="mt-1 text-xl font-semibold">{state.closedThrough ? `${jp(state.closedThrough)}まで締め済み` : "まだ締めていません"}</div>
        {state.closedThrough && <p className="mt-1 text-sm text-slate-600">{jp(state.closedThrough)}以前の日付の仕訳は変更できません。</p>}
      </div>

      {canEdit ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">締める日を選ぶ</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDate(state.lastMonthEnd)} className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
              先月末({jp(state.lastMonthEnd)})
            </button>
            <button type="button" onClick={() => setDate(state.lastFiscalYearEnd)} className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
              前期末({jp(state.lastFiscalYearEnd)})
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-500">
              この日まで締める
              <input type="date" value={date} max={state.today} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900" />
            </label>
            <button onClick={() => save(date)} disabled={busy || !date} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              締める
            </button>
            {state.closedThrough && (
              <button onClick={() => save(null)} disabled={busy} className="rounded-md border border-rose-200 px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                締めを解除する
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            レビュー待ちの仕訳や確認待ちの銀行明細が残っている期間は締められません。締めた後に修正が必要になったら、締めを解除してから直し、もう一度締めてください(締め・解除は操作ログに残ります)。
          </p>
        </section>
      ) : (
        <p className="text-sm text-slate-500">締め・締めの解除は管理者だけができます。</p>
      )}
    </div>
  );
}
