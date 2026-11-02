"use client";

import Link from "next/link";
import { useState } from "react";

type Req = { id: string; userName: string; item: string; quantity: number; unit: string | null; note: string | null; urgent: boolean; status: string; purchaseOrderId: string | null; reply: string | null; createdAt: string };
type Group = { key: string; item: string; unit: string | null; quantity: number; urgent: boolean; requests: Req[]; last: { unitPrice: number; taxRate: number; vendor: string; date: string } | null };
type Data = { groups: Group[]; others: Req[] };
type Pick = { on: boolean; description: string; quantity: string; unitPrice: string; taxRate: string };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const STATUS: Record<string, string> = { OPEN: "依頼中", ORDERED: "発注した", DONE: "届いた", REJECTED: "見送り" };
const md = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" });

export default function SuppliesView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const init = (d: Data) => Object.fromEntries(d.groups.map((g) => [g.key, { on: false, description: g.item, quantity: String(g.quantity), unitPrice: g.last ? String(g.last.unitPrice) : "", taxRate: String(g.last?.taxRate ?? 10) }]));
  const [picks, setPicks] = useState<Record<string, Pick>>(init(initial));
  const [vendor, setVendor] = useState(initial.groups.find((g) => g.last)?.last?.vendor ?? "");
  const [delivery, setDelivery] = useState("");
  const [rejecting, setRejecting] = useState<{ id: string; reply: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, body?: unknown) {
    const res = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
    return json;
  }
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const reload = async () => {
    const d = await call("/api/supplies");
    setData(d);
    setPicks(init(d));
  };
  const chosen = data.groups.filter((g) => picks[g.key]?.on);
  const total = chosen.reduce((s, g) => s + Math.floor((Number(picks[g.key].quantity) || 0) * (Number(picks[g.key].unitPrice) || 0)), 0);
  const order = () =>
    run("order", async () => {
      const r = await call("/api/supplies", { vendorName: vendor, deliveryDate: delivery, items: chosen.map((g) => ({ requestIds: g.requests.map((x) => x.id), description: picks[g.key].description, quantity: Number(picks[g.key].quantity), unit: g.unit, unitPrice: Number(picks[g.key].unitPrice), taxRate: Number(picks[g.key].taxRate) })) });
      setFlash(`発注書 ${r.order.orderNumber}(税込 ${r.order.totalAmount.toLocaleString()}円)を作りました。依頼${r.count}件を「発注した」にしました`);
      await reload();
    });
  const update = (id: string, body: Record<string, unknown>) =>
    run(id, async () => {
      await call(`/api/supplies/${id}`, body);
      setRejecting(null);
      await reload();
    });

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">依頼中({data.groups.reduce((s, g) => s + g.requests.length, 0)}件)</h2>
        {data.groups.length === 0 ? (
          <p className="text-slate-500">依頼中のものはありません。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.groups.map((g) => {
              const p = picks[g.key];
              return (
                <li key={g.key} className="space-y-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="flex items-center gap-2 font-medium">
                      <input type="checkbox" checked={p?.on ?? false} onChange={(e) => setPicks({ ...picks, [g.key]: { ...p, on: e.target.checked } })} />
                      {g.item}
                    </label>
                    <span className="tabular-nums">
                      {g.quantity}
                      {g.unit ?? ""}
                    </span>
                    {g.urgent && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-800 ring-1 ring-rose-200">至急</span>}
                    <span className="text-xs text-slate-500">{g.requests.map((r) => `${r.userName}(${md(r.createdAt)}${r.note ? `・${r.note}` : ""})`).join("、")}</span>
                    {g.last && (
                      <span className="text-xs text-slate-500">
                        前回: {g.last.vendor} {g.last.unitPrice.toLocaleString()}円({g.last.date})
                      </span>
                    )}
                  </div>
                  {p?.on && (
                    <div className="grid gap-2 pl-6 sm:grid-cols-[1fr_6rem_8rem_6rem]">
                      <input aria-label="品名" value={p.description} onChange={(e) => setPicks({ ...picks, [g.key]: { ...p, description: e.target.value } })} className={input} />
                      <input aria-label="数" inputMode="decimal" value={p.quantity} onChange={(e) => setPicks({ ...picks, [g.key]: { ...p, quantity: e.target.value } })} className={input} />
                      <input aria-label="単価" inputMode="numeric" placeholder="単価(税抜)" value={p.unitPrice} onChange={(e) => setPicks({ ...picks, [g.key]: { ...p, unitPrice: e.target.value } })} className={input} />
                      <select aria-label="税率" value={p.taxRate} onChange={(e) => setPicks({ ...picks, [g.key]: { ...p, taxRate: e.target.value } })} className={input}>
                        <option value="10">10%</option>
                        <option value="8">8%</option>
                      </select>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 pl-6">
                    {g.requests.map((r) =>
                      rejecting?.id === r.id ? (
                        <span key={r.id} className="flex flex-wrap items-center gap-2">
                          <input aria-label="見送る理由" value={rejecting.reply} onChange={(e) => setRejecting({ id: r.id, reply: e.target.value })} placeholder={`${r.userName}さんへ: 見送る理由`} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                          <button onClick={() => update(r.id, { status: "REJECTED", reply: rejecting.reply })} className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700">
                            見送る
                          </button>
                          <button onClick={() => setRejecting(null)} className="text-xs text-slate-500">
                            やめる
                          </button>
                        </span>
                      ) : (
                        <button key={r.id} onClick={() => setRejecting({ id: r.id, reply: "" })} className="text-xs text-slate-400 hover:text-rose-700">
                          {r.userName}さんの依頼を見送る
                        </button>
                      ),
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {chosen.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3">
            <label className="text-xs text-slate-600">
              発注先
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="例: アスクル" className={input} />
            </label>
            <label className="text-xs text-slate-600">
              納期
              <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className={input} />
            </label>
            <span className="text-sm">
              {chosen.length}品・税抜 {total.toLocaleString()}円
            </span>
            <button onClick={order} disabled={!!busy || !vendor.trim()} className="ml-auto rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "order" ? "作っています…" : "発注書を作る"}
            </button>
          </div>
        )}
      </section>

      {data.others.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">発注した・届いた・見送り(30日)</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {data.others.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{r.item}</span>
                <span className="tabular-nums">
                  {r.quantity}
                  {r.unit ?? ""}
                </span>
                <span className="text-xs text-slate-500">{r.userName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "DONE" ? "bg-emerald-50 text-emerald-800" : r.status === "REJECTED" ? "bg-slate-100 text-slate-600" : "bg-indigo-50 text-indigo-800"}`}>{STATUS[r.status]}</span>
                {r.reply && <span className="text-xs text-slate-500">{r.reply}</span>}
                {r.purchaseOrderId && (
                  <Link href="/purchase-orders" className="text-xs text-indigo-700 underline">
                    発注書
                  </Link>
                )}
                {r.status === "ORDERED" && (
                  <button onClick={() => update(r.id, { status: "DONE" })} disabled={busy === r.id} className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                    届いた
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
