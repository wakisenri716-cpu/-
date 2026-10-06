"use client";

import { useCallback, useEffect, useState } from "react";

type Product = {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  quantity: number;
  reorderPoint: number | null;
  low: boolean;
  recent: { type: "PURCHASE" | "ISSUE" | "STOCKTAKE"; date: string; quantity: number; memo: string | null }[];
};
type Mode = "ISSUE" | "STOCKTAKE";

const TYPE_LABEL = { PURCHASE: "入荷", ISSUE: "出庫", STOCKTAKE: "棚卸" };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export function StockView({ initialLow }: { initialLow: boolean }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [query, setQuery] = useState("");
  const [onlyLow, setOnlyLow] = useState(initialLow);
  const [selected, setSelected] = useState<Product | null>(null);
  const [mode, setMode] = useState<Mode>("ISSUE");
  const [qty, setQty] = useState(1);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/staff-app/stock");
    if (res.ok) setProducts((await res.json()).products);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function open(p: Product, m: Mode) {
    setSelected(p);
    setMode(m);
    setQty(m === "ISSUE" ? 1 : p.quantity);
    setMemo("");
    setError(null);
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff-app/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: selected.id, type: mode, quantity: qty, memo }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "記録できませんでした");
    setMessage(`${json.name}: ${mode === "ISSUE" ? `${qty}${json.unit}出庫しました` : "棚卸の数を記録しました"}(いまの在庫 ${json.quantity}${json.unit})`);
    setSelected(null);
    await load();
  }

  if (!products) return <p className="py-10 text-center text-sm text-slate-400">読み込み中...</p>;
  const q = query.trim().toLowerCase();
  const list = products.filter((p) => (!onlyLow || p.low) && (!q || p.name.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q)));
  const lowCount = products.filter((p) => p.low).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">在庫</h1>
        <p className="text-sm text-slate-500">使った分は「出庫」、数えた数は「棚卸」で記録します。入荷は管理者が記録します。</p>
      </div>
      {message && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p>}
      <div className="space-y-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="商品名・コードで探す" className="w-full rounded-xl border px-4 py-2.5 text-sm" type="search" />
        <div className="flex gap-2 text-sm">
          <button onClick={() => setOnlyLow(false)} className={`rounded-full px-3 py-1 ${!onlyLow ? "bg-indigo-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            すべて {products.length}
          </button>
          <button onClick={() => setOnlyLow(true)} className={`rounded-full px-3 py-1 ${onlyLow ? "bg-rose-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            少ない {lowCount}
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className={`rounded-xl bg-white p-3 shadow-sm ring-1 ${p.low ? "ring-rose-200" : "ring-slate-200"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {p.name}
                  {p.low && <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">{p.quantity <= 0 ? "在庫切れ" : "少ない"}</span>}
                </p>
                <p className="text-xs text-slate-500">{[p.code, p.reorderPoint !== null && `発注点 ${p.reorderPoint}${p.unit}`].filter(Boolean).join(" / ")}</p>
              </div>
              <p className={`shrink-0 text-2xl font-semibold tabular-nums ${p.low ? "text-rose-700" : ""}`}>
                {p.quantity}
                <span className="ml-0.5 text-sm font-normal text-slate-500">{p.unit}</span>
              </p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => open(p, "ISSUE")} disabled={p.quantity <= 0} className="rounded-lg bg-indigo-50 py-2 text-sm font-medium text-indigo-700 disabled:opacity-40">
                出庫する
              </button>
              <button onClick={() => open(p, "STOCKTAKE")} className="rounded-lg bg-slate-100 py-2 text-sm font-medium text-slate-700">
                数を数えた(棚卸)
              </button>
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">{products.length ? "条件に合う商品はありません" : "まだ商品が登録されていません(管理者が「在庫管理」で登録します)"}</li>}
      </ul>

      {selected && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl">
            <div>
              <p className="text-xs text-slate-500">{mode === "ISSUE" ? "出庫(使った・出した数)" : "棚卸(実際に数えた数)"}</p>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="text-sm text-slate-500">
                いまの在庫: {selected.quantity}
                {selected.unit}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setQty(Math.max(0, qty - 1))} className="h-12 w-12 rounded-full bg-slate-100 text-2xl" aria-label="1つ減らす">
                −
              </button>
              <input value={qty} onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value.replace(/[^\d]/g, "")) || 0)))} inputMode="numeric" className="w-28 rounded-xl border py-2 text-center text-3xl font-semibold tabular-nums" aria-label="数" />
              <button onClick={() => setQty(qty + 1)} className="h-12 w-12 rounded-full bg-slate-100 text-2xl" aria-label="1つ増やす">
                ＋
              </button>
            </div>
            {mode === "STOCKTAKE" && qty !== selected.quantity && (
              <p className="text-center text-sm text-amber-700">
                帳簿より {Math.abs(qty - selected.quantity)}
                {selected.unit} {qty > selected.quantity ? "多い" : "少ない"}です
              </p>
            )}
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder={mode === "ISSUE" ? "メモ(任意) 例: 店頭で使用" : "メモ(任意) 例: 月末の棚卸"} className="w-full rounded-lg border px-3 py-2 text-sm" />
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSelected(null)} className="rounded-xl border py-3 text-sm">
                やめる
              </button>
              <button onClick={submit} disabled={busy || (mode === "ISSUE" && qty <= 0)} className="rounded-xl bg-vermilion-600 py-3 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy ? "記録中..." : "記録する"}
              </button>
            </div>
            {selected.recent.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">最近の動き</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {selected.recent.map((r, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        {md(r.date)} {TYPE_LABEL[r.type]} {r.memo}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {r.quantity > 0 ? "+" : ""}
                        {r.quantity}
                        {selected.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
