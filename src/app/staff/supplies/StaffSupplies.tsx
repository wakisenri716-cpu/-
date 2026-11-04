"use client";

import { useEffect, useState } from "react";

type Item = { item: string; quantity: number; unit: string | null; urgent: boolean };
type Req = { id: string; item: string; quantity: number; unit: string | null; urgent: boolean; status: string; reply: string | null; createdAt: string };
const STATUS: Record<string, string> = { OPEN: "依頼中", ORDERED: "発注しました", DONE: "届きました", REJECTED: "見送り" };
const md = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" });

export function StaffSupplies({ initialText = "" }: { initialText?: string }) {
  const [list, setList] = useState<Req[] | null>(null);
  const [text, setText] = useState(initialText);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [mode, setMode] = useState<string>("template");
  useEffect(() => {
    fetch("/api/staff-app/supplies")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setList(d.requests ?? []))
      .catch(() => setList([]));
  }, []);

  // 書いたものを品物ごとに分けて見せる(AIが使えればAIで)
  async function preview() {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch("/api/staff-app/supplies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, preview: true }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "読み取れませんでした");
    setItems(json.items);
    setMode(json.mode);
  }

  async function send() {
    if (!items?.length) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff-app/supplies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, note }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "頼めませんでした");
    setList((l) => [...json.requests.slice().reverse(), ...(l ?? [])]);
    setDone(`${json.requests.length}件を総務に頼みました`);
    setText("");
    setNote("");
    setItems(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">購入依頼</h1>
        <p className="mt-1 text-sm text-slate-600">備品・消耗品がほしいときに、総務に頼みます。「コピー用紙 A4 5箱」「トナー 至急」のように書いてください。いくつか並べて書いてもかまいません。</p>
      </div>
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="例: コピー用紙 A4 5箱とトナー、あと付箋も" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="ひとこと(任意・例: いつもの白いもの)" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        {!items ? (
          <button onClick={preview} disabled={busy || !text.trim()} className="w-full rounded-xl bg-vermilion-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "読み取っています…" : "読み取る"}
          </button>
        ) : (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">{mode === "claude" ? "AIが品物ごとに分けました" : "品物ごとに分けました"}(数を直したり、外したりできます)</p>
            <ul className="space-y-1.5">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {it.item}
                    {it.urgent && <span className="ml-1 rounded-full bg-rose-50 px-1.5 text-[10px] text-rose-700">至急</span>}
                  </span>
                  <input aria-label={`${it.item}の数`} inputMode="decimal" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x)))} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm" />
                  <span className="w-10 text-xs text-slate-500">{it.unit ?? ""}</span>
                  <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-xs text-slate-400" aria-label={`${it.item}を外す`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button onClick={send} disabled={busy || !items.length} className="flex-1 rounded-xl bg-vermilion-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "頼んでいます…" : `${items.length}件を総務に頼む`}
              </button>
              <button onClick={() => setItems(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                書き直す
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {done && <p className="text-sm text-emerald-700">{done}</p>}
      </section>
      <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">頼んだもの</h2>
        {list === null ? (
          <p className="mt-2 text-slate-500">読み込んでいます…</p>
        ) : list.length === 0 ? (
          <p className="mt-2 text-slate-500">まだありません。</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-xs text-slate-500">{md(r.createdAt)}</span>
                <span className="font-medium">{r.item}</span>
                <span>
                  {r.quantity}
                  {r.unit ?? ""}
                </span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${r.status === "DONE" ? "bg-emerald-50 text-emerald-800" : r.status === "REJECTED" ? "bg-slate-100 text-slate-600" : r.status === "ORDERED" ? "bg-indigo-50 text-indigo-800" : "bg-amber-50 text-amber-900"}`}>{STATUS[r.status]}</span>
                {r.reply && <span className="w-full text-xs text-slate-500">総務より: {r.reply}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
