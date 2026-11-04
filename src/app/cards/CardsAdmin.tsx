"use client";

import { useState } from "react";

type Row = { id: string; userName: string; nameKana: string | null; nameEn: string | null; title: string | null; titleEn: string | null; department: string | null; email: string | null; phone: string | null; mobile: string | null; quantity: number; note: string | null; status: string; createdAt: string };
type Data = { orders: Row[]; lastPrinter: string | null };
const STATUS: Record<string, string> = { REQUESTED: "申し込み", ORDERED: "発注した", DELIVERED: "届いた", CANCELLED: "取り消し" };

export default function CardsAdmin({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [picked, setPicked] = useState<string[]>(initial.orders.filter((o) => o.status === "REQUESTED").map((o) => o.id));
  const [to, setTo] = useState(initial.lastPrinter ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  async function run(key: string, body: unknown, ok: (r: { count: number }) => string) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
      setFlash(ok(json));
      const fresh = await (await fetch("/api/cards")).json();
      setData(fresh);
      setPicked(fresh.orders.filter((o: Row) => o.status === "REQUESTED").map((o: Row) => o.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const requested = data.orders.filter((o) => o.status === "REQUESTED");
  const ordered = data.orders.filter((o) => o.status === "ORDERED");
  const others = data.orders.filter((o) => o.status === "DELIVERED" || o.status === "CANCELLED");
  const detail = (o: Row) => [o.title, o.department, o.email, o.phone, o.mobile, o.nameEn, o.titleEn].filter(Boolean).join("・");

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
      <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">申し込み({requested.length}件)</h2>
        {requested.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {requested.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <input type="checkbox" aria-label={`${o.userName}を発注する`} checked={picked.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />
                  <span className="font-medium">{o.userName}</span>
                  {o.nameKana && <span className="text-xs text-slate-500">{o.nameKana}</span>}
                  <span>{o.quantity}枚</span>
                  <span className="text-xs text-slate-600">{detail(o)}</span>
                  {o.note && <span className="text-xs text-amber-800">「{o.note}」</span>}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">
                印刷会社のメール
                <input aria-label="印刷会社のメール" value={to} onChange={(e) => setTo(e.target.value)} placeholder="print@example.com" className="block w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <button onClick={() => confirm(`${picked.length}名分を${to}に発注しますか?`) && run("order", { action: "order", ids: picked, to }, (r) => `${r.count}名分を印刷会社に頼みました`)} disabled={!!busy || !picked.length} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "order" ? "送っています…" : `${picked.length}名分をまとめて発注`}
              </button>
            </div>
          </>
        ) : (
          <p className="text-slate-500">いま申し込みはありません。</p>
        )}
      </section>
      {ordered.length > 0 && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">印刷中({ordered.length}件)</h2>
            <button onClick={() => run("delivered", { action: "delivered", ids: ordered.map((o) => o.id) }, (r) => `${r.count}名に届いたことを知らせました`)} disabled={!!busy} className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
              ぜんぶ届いた
            </button>
          </div>
          <p className="text-slate-600">{ordered.map((o) => `${o.userName}(${o.quantity}枚)`).join("、")}</p>
        </section>
      )}
      {others.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">これまで(半年)</h2>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            {others.map((o) => (
              <li key={o.id}>
                {new Date(o.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} {o.userName} {o.quantity}枚 — {STATUS[o.status]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
