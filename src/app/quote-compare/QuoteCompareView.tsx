"use client";

import Link from "next/link";
import { useState } from "react";
import type { Comparison } from "@/lib/quoteCompareText";

type Entry = { vendor: string; text: string };
type Result = Comparison & { mode: "claude" | "template" };

const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
const yen = (n: number) => `${n.toLocaleString()}円`;
const SAMPLE = "例:\nコピー用紙 A4 10箱 2,800 28,000\nトナーカートリッジ 2本 12,000 24,000\n送料 1,000円\n合計 58,300円\n納期 10月20日";

export default function QuoteCompareView({ ai, vendors }: { ai: boolean; vendors: string[] }) {
  const [entries, setEntries] = useState<Entry[]>([
    { vendor: "", text: "" },
    { vendor: "", text: "" },
  ]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ordered, setOrdered] = useState<Record<number, { id: string; orderNumber: string }>>({});

  const set = (i: number, patch: Partial<Entry>) => setEntries((e) => e.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function compare(useAi: boolean) {
    setBusy(useAi ? "ai" : "compare");
    setError(null);
    setOrdered({});
    try {
      const res = await fetch("/api/quote-compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotes: entries, useAi }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "比べられませんでした");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "比べられませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function order(i: number) {
    if (!result) return;
    const q = result.quotes[i];
    setBusy(`order-${i}`);
    setError(null);
    try {
      const res = await fetch("/api/quote-compare/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: q.vendor, quote: q }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "発注書を作れませんでした");
      setOrdered((o) => ({ ...o, [i]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "発注書を作れませんでした");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <datalist id="vendor-names">
        {vendors.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {entries.map((e, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <label className="block flex-1 text-sm">
                  <span className="text-slate-700">仕入先 {i + 1}</span>
                  <input value={e.vendor} onChange={(ev) => set(i, { vendor: ev.target.value })} list="vendor-names" placeholder="例: 〇〇商事" className={input} />
                </label>
                {entries.length > 2 && (
                  <button onClick={() => setEntries((x) => x.filter((_, j) => j !== i))} className="pb-2 text-xs text-slate-500 hover:text-rose-700">
                    外す
                  </button>
                )}
              </div>
              <label className="block text-sm">
                <span className="text-slate-700">見積の内容(貼り付け)</span>
                <textarea value={e.text} onChange={(ev) => set(i, { text: ev.target.value })} rows={7} placeholder={i === 0 ? SAMPLE : ""} className={`${input} font-mono text-xs`} />
              </label>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {entries.length < 5 && (
            <button onClick={() => setEntries((x) => [...x, { vendor: "", text: "" }])} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              ＋ 見積を足す
            </button>
          )}
          <button onClick={() => compare(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "compare" ? "比べています…" : "比べる"}
          </button>
          {ai && (
            <button onClick={() => compare(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが読み取っています…" : "AIで読み取る"}
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      {result && (
        <>
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">比べた結果</h2>
              <span className="text-xs text-slate-500">{result.mode === "claude" ? "AIが明細を読み取りました" : "決まったルールで読み取りました"}</span>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-slate-700">
              {result.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.quotes.map((q, i) => (
              <section key={i} className={`space-y-2 rounded-xl border bg-white p-4 text-sm shadow-sm ${i === result.best ? "border-emerald-400 ring-1 ring-emerald-300" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{q.vendor}</h3>
                  {i === result.best && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">おすすめ</span>}
                  {i === result.cheapest && i !== result.best && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">合計がいちばん安い</span>}
                </div>
                <p className="text-2xl font-semibold tabular-nums">{yen(q.total)}</p>
                <p className="text-xs text-slate-500 tabular-nums">
                  税抜 {yen(q.subtotal)}・消費税 {yen(q.tax)}
                  {q.taxIncluded ? "(税込の見積)" : ""}
                </p>
                <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="text-slate-500">品目</dt>
                  <dd>{q.lines.length}品目</dd>
                  <dt className="text-slate-500">送料</dt>
                  <dd>{q.shipping ? yen(q.shipping) : "なし"}</dd>
                  {q.discount > 0 && (
                    <>
                      <dt className="text-slate-500">値引</dt>
                      <dd>-{yen(q.discount)}</dd>
                    </>
                  )}
                  <dt className="text-slate-500">納期</dt>
                  <dd>{q.delivery ?? "—"}</dd>
                  <dt className="text-slate-500">支払条件</dt>
                  <dd>{q.paymentTerms ?? "—"}</dd>
                  <dt className="text-slate-500">有効期限</dt>
                  <dd>{q.validUntil ?? "—"}</dd>
                </dl>
                {q.warnings.length > 0 && (
                  <ul className="space-y-0.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    {q.warnings.map((w) => (
                      <li key={w}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
                {ordered[i] ? (
                  <Link href={`/purchase-orders/${ordered[i].id}`} className="inline-block text-emerald-700 hover:underline">
                    発注書 {ordered[i].orderNumber} を作りました →
                  </Link>
                ) : (
                  q.lines.length > 0 && (
                    <button onClick={() => order(i)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                      {busy === `order-${i}` ? "作っています…" : "この見積で発注書を作る"}
                    </button>
                  )
                )}
              </section>
            ))}
          </div>

          {result.rows.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
              <h2 className="font-semibold">品目ごとの単価(税抜にそろえています)</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2 pr-3 font-medium">品目</th>
                      {result.quotes.map((q, i) => (
                        <th key={i} className="py-2 pr-3 text-right font-medium">
                          {q.vendor}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.key} className="border-b border-slate-100">
                        <td className="py-2 pr-3">{r.description}</td>
                        {r.prices.map((p, i) => (
                          <td key={i} className={`py-2 pr-3 text-right tabular-nums ${p !== null && p === r.lowest ? "font-semibold text-emerald-700" : ""}`}>
                            {p === null ? (
                              <span className="text-xs text-slate-400">なし</span>
                            ) : (
                              <>
                                {yen(p)}
                                <span className="block text-xs font-normal text-slate-500">× {r.quantities[i]}</span>
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">緑の太字は、その品目でいちばん安い単価です。</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
