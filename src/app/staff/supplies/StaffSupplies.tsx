"use client";

import { useEffect, useState } from "react";

type Req = { id: string; item: string; quantity: number; unit: string | null; urgent: boolean; status: string; reply: string | null; createdAt: string };
const STATUS: Record<string, string> = { OPEN: "依頼中", ORDERED: "発注しました", DONE: "届きました", REJECTED: "見送り" };
const md = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" });

export function StaffSupplies() {
  const [list, setList] = useState<Req[] | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/staff-app/supplies")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setList(d.requests ?? []))
      .catch(() => setList([]));
  }, []);

  async function send() {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch("/api/staff-app/supplies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, note }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "頼めませんでした");
    setList((l) => [json.request, ...(l ?? [])]);
    setDone(`「${json.request.item} ${json.request.quantity}${json.request.unit ?? ""}」を頼みました${json.request.urgent ? "(至急)" : ""}`);
    setText("");
    setNote("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">購入依頼</h1>
        <p className="mt-1 text-sm text-slate-600">備品・消耗品がほしいときに、総務に頼みます。「コピー用紙 A4 5箱」「トナー 至急」のように書いてください。</p>
      </div>
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="例: コピー用紙 A4 5箱 至急" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="ひとこと(任意・例: いつもの白いもの)" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <button onClick={send} disabled={busy || !text.trim()} className="w-full rounded-xl bg-vermilion-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "頼んでいます…" : "総務に頼む"}
        </button>
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
