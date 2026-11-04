"use client";

import { useState } from "react";

type Row = { id: string; date: string; recipient: string; contents: string | null; method: string; methodLabel: string; carrierLabel: string | null; tracking: string | null; trackingUrl: string | null; cost: number; paidBy: string; byName: string; journalEntryId: string | null };
type Data = { month: string; items: Row[]; total: number; cashUnposted: number; cashUnpostedCount: number };
type Draft = { date: string; recipient: string; contents: string | null; method: string; tracking: string | null; cost: number; paidBy: string };
const METHODS: Record<string, string> = { LETTER: "普通郵便", LETTERPACK_LIGHT: "レターパックライト", LETTERPACK_PLUS: "レターパックプラス", SMART_LETTER: "スマートレター", YUPACKET: "ゆうパケット", YUPACK: "ゆうパック", REGISTERED: "書留", EXPRESS: "速達", TAKKYUBIN: "宅急便", NEKOPOS: "ネコポス", HIKYAKU: "飛脚宅配便", OTHER: "そのほか" };
const PRICES: Record<string, number> = { LETTERPACK_LIGHT: 430, LETTERPACK_PLUS: 600, SMART_LETTER: 210 };
const PAID: Record<string, string> = { CASH: "現金で払った", STAMP: "買ってある切手・レターパック", INVOICE: "月払いの請求" };
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
const shift = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default function ShipmentsView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
  const load = async (month = data.month, query = "") => setData(await call(`/api/shipments?month=${month}${query ? `&q=${encodeURIComponent(query)}` : ""}`, "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/shipments", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      await call("/api/shipments", "POST", draft);
      setFlash(`${draft.recipient}への発送を記録しました`);
      setDraft(null);
      setText("");
      await load();
    });
  const post = () =>
    run("post", async () => {
      const r = await call("/api/shipments", "POST", { action: "post", month: data.month });
      setFlash(`${r.count}件・${r.total.toLocaleString()}円を通信費で仕訳しました`);
      await load();
    });
  const remove = (r: Row) =>
    run(r.id, async () => {
      if (!confirm(`${r.recipient}への発送の記録を消しますか?`)) return;
      await call(`/api/shipments/${r.id}`, "DELETE");
      await load();
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: さくら商事へ請求書 レターパックライト 追跡 1234-5678-9012" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <input aria-label="送った日" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={input} />
              <input aria-label="相手" placeholder="相手" value={draft.recipient} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} className={input} />
              <input aria-label="中身" placeholder="中身" value={draft.contents ?? ""} onChange={(e) => setDraft({ ...draft, contents: e.target.value || null })} className={input} />
              <select aria-label="送り方" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value, cost: PRICES[e.target.value] ?? draft.cost })} className={input}>
                {Object.entries(METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input aria-label="追跡番号" placeholder="追跡番号" value={draft.tracking ?? ""} onChange={(e) => setDraft({ ...draft, tracking: e.target.value || null })} className={input} />
              <div className="flex items-center gap-1">
                <input aria-label="送料" inputMode="numeric" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} className={`${input} text-right`} />
                <span className="text-xs text-slate-500">円</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select aria-label="払い方" value={draft.paidBy} onChange={(e) => setDraft({ ...draft, paidBy: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {Object.entries(PAID).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                記録する
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => run("m", () => load(shift(data.month, -1)))} className="rounded-md border border-slate-300 px-2 py-0.5 text-xs">
            ←
          </button>
          <h2 className="font-semibold">
            {Number(data.month.slice(0, 4))}年{Number(data.month.slice(5))}月の発送(送料 {data.total.toLocaleString()}円)
          </h2>
          <button onClick={() => run("m", () => load(shift(data.month, 1)))} className="rounded-md border border-slate-300 px-2 py-0.5 text-xs">
            →
          </button>
          <input aria-label="探す" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run("q", () => load(data.month, q.trim()))} placeholder="相手・中身・追跡番号で探す" className="ml-auto w-56 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          {data.cashUnposted > 0 && (
            <button onClick={post} disabled={!!busy} className="rounded-md bg-vermilion-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              現金の送料 {data.cashUnposted.toLocaleString()}円({data.cashUnpostedCount}件)を通信費で仕訳
            </button>
          )}
        </div>
        {data.items.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-10 text-xs tabular-nums text-slate-600">{md(r.date)}</span>
                <span className="font-medium">{r.recipient}</span>
                {r.contents && <span className="text-xs text-slate-600">{r.contents}</span>}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{r.methodLabel}</span>
                <span className="text-xs">{r.cost.toLocaleString()}円</span>
                <span className="text-xs text-slate-500">
                  {PAID[r.paidBy]}
                  {r.journalEntryId ? "・仕訳済み" : ""}
                </span>
                {r.tracking &&
                  (r.trackingUrl ? (
                    <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 underline">
                      追跡 {r.tracking}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">追跡 {r.tracking}</span>
                  ))}
                <button onClick={() => remove(r)} disabled={busy === r.id} className="ml-auto text-xs text-slate-400 hover:text-rose-700">
                  消す
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">この月の発送の記録はありません。</p>
        )}
      </section>
    </div>
  );
}
