"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { id: string; name: string; price: number };
type Shop = { id: string; name: string; menu: Item[]; cutoff: string; closed: boolean };
type Data = { date: string; shops: Shop[]; mine: { shopId: string; itemId: string; qty: number; price: number }[]; monthTotal: number; monthUnpaid: number };
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${"日月火水木金土"[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;

export function StaffBento() {
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(
    (d?: string) =>
      fetch(`/api/staff-app/bento${d ? `?date=${d}` : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((x) => {
          if (x) {
            setData(x);
            setDate(x.date);
          }
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function order(shopId: string, itemId: string, qty: number) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/staff-app/bento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId, itemId, qty, date }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: json.error || "頼めませんでした" });
    setMsg({ ok: true, text: qty ? "頼みました" : "取り消しました" });
    load(date ?? undefined);
  }
  const today = data?.date;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">お弁当の注文</h1>
        <p className="mt-1 text-sm text-slate-600">締め切りまでに頼んでください。総務がまとめてお店に注文します。締め切りまでは数を変えたり取り消したりできます。</p>
      </div>
      {data && (
        <div className="flex items-center gap-2 text-sm">
          {[0, 1, 2].map((n) => {
            const base = jstToday();
            const d = addDays(base, n);
            return (
              <button key={n} onClick={() => load(d)} aria-pressed={today === d} className={`rounded-full border px-3 py-1 ${today === d ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-900" : "border-slate-300"}`}>
                {n === 0 ? "今日" : n === 1 ? "あした" : md(d)}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-slate-500">今月 {data.monthTotal.toLocaleString()}円{data.monthUnpaid ? `(まだ払っていない ${data.monthUnpaid.toLocaleString()}円)` : ""}</span>
        </div>
      )}
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
      {data === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : data.shops.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">{md(data.date)}は頼めるお店がありません。</p>
      ) : (
        data.shops.map((s) => (
          <section key={s.id} className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{s.name}</h2>
              <span className={`text-xs ${s.closed ? "text-rose-700" : "text-slate-500"}`}>{s.closed ? "締め切りました" : `${s.cutoff}まで`}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {s.menu.map((m) => {
                const q = data.mine.find((o) => o.shopId === s.id && o.itemId === m.id)?.qty ?? 0;
                return (
                  <li key={m.id} className="flex items-center gap-2 py-2">
                    <span className={q ? "font-medium" : ""}>{m.name}</span>
                    <span className="text-xs text-slate-500">{m.price.toLocaleString()}円</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {q > 0 && (
                        <button onClick={() => order(s.id, m.id, q - 1)} disabled={busy || s.closed} className="h-8 w-8 rounded-full border border-slate-300 disabled:opacity-40" aria-label={`${m.name}を減らす`}>
                          −
                        </button>
                      )}
                      {q > 0 && <span className="w-5 text-center font-semibold">{q}</span>}
                      <button onClick={() => order(s.id, m.id, q + 1)} disabled={busy || s.closed} className={`h-8 rounded-full px-3 disabled:opacity-40 ${q ? "w-8 border border-slate-300 px-0" : "bg-vermilion-600 font-medium text-white"}`} aria-label={`${m.name}を頼む`}>
                        {q ? "+" : "頼む"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function jstToday() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
