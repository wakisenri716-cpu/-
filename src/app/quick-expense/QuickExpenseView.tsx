"use client";

import Link from "next/link";
import { useState } from "react";
import { formatYen } from "@/lib/format";

type Item = { date: string; description: string; amount: number; accountCode: string; vendorName: string | null; confidence: number; note: string | null };

const EXAMPLE = "昨日 取引先A社へタクシー 2,400円\n10/3 打ち合わせのカフェ代 1,320円(スターカフェ)\nコピー用紙 980円";

export function QuickExpenseView({ accounts }: { accounts: { code: string; name: string }[] }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/quick-expense", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }

  async function parse() {
    setBusy(true);
    setMessage(null);
    const { ok, json } = await post({ action: "parse", text });
    setBusy(false);
    if (!ok) return setMessage({ ok: false, text: json.error || "読み取れませんでした" });
    setItems(json.items);
    setMode(json.mode);
    if (!json.items.length) setMessage({ ok: false, text: "経費が見つかりませんでした。内容と金額を書いてください。" });
  }

  async function add() {
    if (!items?.length) return;
    setBusy(true);
    setMessage(null);
    const { ok, json } = await post({ action: "add", items });
    setBusy(false);
    if (!ok) return setMessage({ ok: false, text: json.error || "入れられませんでした" });
    setMessage({ ok: true, text: `${items.length}件・${formatYen(json.total)} をあなたの経費精算に入れました。` });
    setItems(null);
    setText("");
  }

  const update = (i: number, patch: Partial<Item>) => setItems((list) => list!.map((it, n) => (n === i ? { ...it, ...patch, note: null } : it)));
  const total = (items ?? []).reduce((s, i) => s + (i.amount || 0), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium" htmlFor="qe-text">
          経費を書く(1行に1件。いくつでも)
        </label>
        <textarea id="qe-text" value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} placeholder={EXAMPLE} className="mt-2 w-full rounded-md border px-3 py-2 text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={parse} disabled={busy || !text.trim()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy && !items ? "AIが読み取っています…" : "AIで読み取る"}
          </button>
          <button type="button" onClick={() => setText(EXAMPLE)} className="text-sm text-slate-500 hover:underline">
            例を入れる
          </button>
        </div>
      </section>

      {message && (
        <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          {message.text}
          {message.ok && (
            <Link href="/expenses" className="ml-2 underline">
              経費精算を見る
            </Link>
          )}
        </div>
      )}

      {items && items.length > 0 && (
        <section className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">読み取った経費({items.length}件・{formatYen(total)})</h2>
            <span className="text-xs text-slate-500">{mode === "claude" ? "AIが読み取りました" : "決まったルールで読み取りました"}。直してから入れられます</span>
          </div>
          <ul className="space-y-3">
            {items.map((it, i) => (
              <li key={i} className={`rounded-lg border p-3 ${it.note ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr_8rem_11rem_auto] sm:items-end">
                  <label className="text-xs text-slate-500">
                    日付
                    <input type="date" value={it.date} onChange={(e) => update(i, { date: e.target.value })} className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm text-slate-900" />
                  </label>
                  <label className="text-xs text-slate-500">
                    内容
                    <input value={it.description} onChange={(e) => update(i, { description: e.target.value })} className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm text-slate-900" />
                  </label>
                  <label className="text-xs text-slate-500">
                    金額(円)
                    <input type="number" min={1} value={it.amount || ""} onChange={(e) => update(i, { amount: Number(e.target.value) })} className="mt-1 block w-full rounded-md border px-2 py-1.5 text-right text-sm text-slate-900 tabular-nums" />
                  </label>
                  <label className="text-xs text-slate-500">
                    勘定科目
                    <select value={it.accountCode} onChange={(e) => update(i, { accountCode: e.target.value })} className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm text-slate-900">
                      {accounts.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button onClick={() => setItems((list) => list!.filter((_, n) => n !== i))} className="justify-self-end text-xs text-rose-600 hover:underline">
                    はずす
                  </button>
                </div>
                {(it.vendorName || it.note) && (
                  <p className="mt-1 text-xs text-slate-600">
                    {it.vendorName && <span className="mr-2">支払先: {it.vendorName}</span>}
                    {it.note && <span className="text-amber-800">{it.note}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button onClick={() => setItems(null)} className="rounded-md border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              やめる
            </button>
            <button onClick={add} disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "入れています…" : "経費精算に入れる"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
