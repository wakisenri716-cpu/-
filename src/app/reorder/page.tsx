"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatYen } from "@/lib/format";

type Row = { productId: string; code: string | null; name: string; unit: string; onHand: number; reorderPoint: number | null; dailyUse: number; daysLeft: number | null; onOrder: number; suggested: number; unitPrice: number; taxRate: number; vendorName: string | null; reasons: string[]; aiNote: string | null };
type Data = { needed: Row[]; others: Row[]; checked: number; summary?: string; mode?: string };
type Pick = { on: boolean; quantity: string; unitPrice: string; vendorName: string };

const addDays = (n: number) => new Date(Date.now() + 9 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

// 発注の提案: 在庫が早くなくなる商品と、発注する数の目安。選んで発注書を作る
export default function ReorderPage() {
  const [lead, setLead] = useState("7");
  const [cover, setCover] = useState("30");
  const [data, setData] = useState<Data | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [deliveryDate, setDeliveryDate] = useState(addDays(7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; orderNumber: string; vendor: string; total: number }[] | null>(null);

  const apply = useCallback((body: Data) => {
    setData(body);
    setPicks(Object.fromEntries(body.needed.map((r) => [r.productId, { on: true, quantity: String(r.suggested), unitPrice: r.unitPrice ? String(r.unitPrice) : "", vendorName: r.vendorName ?? "" }])));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/reorder?lead=${lead}&cover=${cover}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || "読み込めませんでした");
    else apply(body);
  }, [lead, cover, apply]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "できませんでした");
      return null;
    }
    return body;
  }

  async function review() {
    const body = await post({ action: "review", leadDays: lead, coverDays: cover });
    if (body) apply(body);
  }

  async function order() {
    if (!data) return;
    const items = data.needed.filter((r) => picks[r.productId]?.on).map((r) => ({ productId: r.productId, quantity: picks[r.productId].quantity, unitPrice: picks[r.productId].unitPrice, vendorName: picks[r.productId].vendorName, taxRate: r.taxRate }));
    const body = await post({ action: "order", items, deliveryDate });
    if (body) {
      setCreated(body.created);
      load();
    }
  }

  const set = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const chosen = data?.needed.filter((r) => picks[r.productId]?.on) ?? [];
  const total = chosen.reduce((s, r) => s + (Number(picks[r.productId].quantity) || 0) * (Number(picks[r.productId].unitPrice) || 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">発注の提案</h1>
        <p className="mt-1 text-sm text-slate-600">
          直近60日の出庫から1日に使う量を出し、在庫が早くなくなる商品と発注する数の目安を出します。発注先・単価は前回の発注書(なければ前回の仕入)から入れています。選んで「発注書を作る」と、発注先ごとに発注書ができます(
          <Link href="/inventory" className="text-indigo-700 hover:underline">在庫管理</Link>・<Link href="/purchase-orders" className="text-indigo-700 hover:underline">発注書</Link>)。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <label className="text-xs text-slate-600">
          納品までの日数
          <input type="number" min={0} max={90} value={lead} onChange={(e) => setLead(e.target.value)} className="mt-0.5 block w-24 rounded-md border px-2 py-1 text-right" />
        </label>
        <label className="text-xs text-slate-600">
          次の発注までの日数(何日分を頼むか)
          <input type="number" min={0} max={180} value={cover} onChange={(e) => setCover(e.target.value)} className="mt-0.5 block w-24 rounded-md border px-2 py-1 text-right" />
        </label>
        <button type="button" onClick={review} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          AIの見立てを聞く
        </button>
      </div>

      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {created && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          発注書を作りました:{" "}
          {created.map((c) => (
            <Link key={c.id} href={`/purchase-orders/${c.id}`} className="mr-2 underline">
              {c.orderNumber}({c.vendor}・{formatYen(c.total)})
            </Link>
          ))}
          ― 内容を確かめて、印刷・メールで送ってください。
        </div>
      )}
      {data?.summary && <p className={`rounded-lg px-4 py-2 text-sm ${data.mode === "claude" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}>{data.summary}</p>}

      {data && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-4 py-2 font-semibold">発注が必要そうな商品({data.needed.length}件)</h2>
          {data.needed.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">いまは発注が必要そうな商品はありません({data.checked}商品を確かめました)。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">商品</th>
                    <th className="px-3 py-2 text-right">在庫</th>
                    <th className="px-3 py-2 text-right">1日に使う量</th>
                    <th className="px-3 py-2 text-right">もつ日数</th>
                    <th className="px-3 py-2">発注する数</th>
                    <th className="px-3 py-2">単価(税抜)</th>
                    <th className="px-3 py-2">発注先</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.needed.map((r) => {
                    const p = picks[r.productId];
                    if (!p) return null;
                    return (
                      <tr key={r.productId} className="align-top">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={p.on} onChange={(e) => set(r.productId, { on: e.target.checked })} aria-label={`${r.name}を発注する`} />
                        </td>
                        <td className="min-w-[12rem] px-3 py-2">
                          <p className="font-medium">{r.name}</p>
                          <p className="text-xs text-rose-700">{r.reasons.join(" ・ ")}</p>
                          {r.aiNote && <p className="text-xs text-indigo-700">AI: {r.aiNote}</p>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {r.onHand}
                          {r.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {r.dailyUse}
                          {r.unit}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${r.daysLeft !== null && r.daysLeft <= 7 ? "font-semibold text-rose-700" : ""}`}>{r.daysLeft === null ? "—" : `${r.daysLeft}日`}</td>
                        <td className="px-3 py-2">
                          <input inputMode="numeric" value={p.quantity} onChange={(e) => set(r.productId, { quantity: e.target.value })} className="w-20 rounded-md border px-2 py-1 text-right" />
                          <span className="ml-1 text-xs text-slate-500">{r.unit}</span>
                        </td>
                        <td className="px-3 py-2">
                          <input inputMode="numeric" value={p.unitPrice} onChange={(e) => set(r.productId, { unitPrice: e.target.value })} className="w-24 rounded-md border px-2 py-1 text-right" />
                        </td>
                        <td className="px-3 py-2">
                          <input value={p.vendorName} onChange={(e) => set(r.productId, { vendorName: e.target.value })} placeholder="発注先" className="w-40 rounded-md border px-2 py-1" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.needed.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 text-sm">
              <span className="text-slate-600">
                {chosen.length}件・合計 {formatYen(total)}(税抜)
              </span>
              <label className="text-xs text-slate-600">
                納期
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="ml-1 rounded-md border px-2 py-1" />
              </label>
              <button type="button" onClick={order} disabled={busy || chosen.length === 0} className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                発注書を作る
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
