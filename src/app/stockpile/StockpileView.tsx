"use client";

import { useState } from "react";

type Category = "WATER" | "FOOD" | "TOILET" | "MEDICAL" | "OTHER";
type Item = { id: string; name: string; category: Category; quantity: number; unit: string | null; amountPerUnit: number | null; expiresOn: string | null; place: string | null; note: string | null; state: "OK" | "SOON" | "EXPIRED"; days: number | null };
type Coverage = { category: Category; label: string; unit: string; have: number; need: number; short: number; days: number | null; unknown: number };
type Data = { today: string; people: number; staffCount: number; items: Item[]; coverage: Coverage[]; alerts: number };
type Draft = { id?: string; name: string; category: Category; quantity: number | null; unit: string | null; amountPerUnit: number | null; expiresOn: string | null; place: string | null };

const CATEGORIES: Record<Category, string> = { WATER: "水", FOOD: "食料", TOILET: "簡易トイレ", MEDICAL: "救急・衛生", OTHER: "そのほか" };
const AMOUNT_LABEL: Partial<Record<Category, string>> = { WATER: "1つあたりのリットル", FOOD: "1つあたりの食数", TOILET: "1つあたりの回数" };
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const ymd = (k: string | null) => (k ? `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "期限なし");

export default function StockpileView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [people, setPeople] = useState("");
  const [text, setText] = useState("");
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
  const load = async (p = people) => setData(await call(`/api/stockpile${Number(p) > 0 ? `?people=${Number(p)}` : ""}`, "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/stockpile", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      const { item } = draft.id ? await call(`/api/stockpile/${draft.id}`, "PATCH", draft) : await call("/api/stockpile", "POST", draft);
      setFlash(`${item.name}を${draft.id ? "直しました" : "記録しました"}`);
      setDraft(null);
      setText("");
      await load();
    });
  const remove = (i: Item) =>
    run(i.id, async () => {
      if (!confirm(`${i.name}の記録を消しますか?`)) return;
      await call(`/api/stockpile/${i.id}`, "DELETE");
      await load();
    });
  const items = [...data.items].sort((a, b) => (a.state === b.state ? 0 : a.state === "EXPIRED" ? -1 : b.state === "EXPIRED" ? 1 : a.state === "SOON" ? -1 : b.state === "SOON" ? 1 : 0));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">3日分は足りている?</h2>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            人数
            <input aria-label="人数" inputMode="numeric" value={people} placeholder={String(data.staffCount)} onChange={(e) => setPeople(e.target.value.replace(/[^\d]/g, ""))} onBlur={() => run("people", () => load())} className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            人(空なら在籍している社員 {data.staffCount}人)
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {data.coverage.map((c) => {
            const ok = c.need > 0 && c.short === 0;
            const pct = c.need ? Math.min(100, Math.round((c.have / c.need) * 100)) : 0;
            return (
              <div key={c.category} className={`rounded-lg border p-3 ${ok ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.label}</span>
                  <span className={`text-xs ${ok ? "text-emerald-800" : "text-amber-900"}`}>{c.need === 0 ? "人数がいません" : ok ? "足りています" : `あと ${c.short.toLocaleString()}${c.unit}`}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200" role="img" aria-label={`${c.label} ${pct}%`}>
                  <div className={`h-full rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-slate-600">
                  {c.have.toLocaleString()} / {c.need.toLocaleString()}
                  {c.unit}
                  {c.days != null && `(${c.days}日分)`}
                </p>
                {c.unknown > 0 && <p className="mt-1 text-xs text-amber-800">1本あたりのリットルが入っていない水が{c.unknown}件あります(数えていません)</p>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">期限の切れたものは数えません。めやすは1人1日あたり 水3リットル・食料3食・簡易トイレ5回です。</p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 保存水 2L 24本 2030/3まで 倉庫" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
              <label className="text-xs text-slate-600 lg:col-span-2">
                品物
                <input aria-label="品物" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} />
              </label>
              <label className="text-xs text-slate-600">
                種類
                <select aria-label="種類" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })} className={input}>
                  {(Object.keys(CATEGORIES) as Category[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORIES[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                数
                <span className="flex gap-1">
                  <input aria-label="数" inputMode="numeric" value={draft.quantity ?? ""} onChange={(e) => setDraft({ ...draft, quantity: e.target.value === "" ? null : Number(e.target.value.replace(/[^\d]/g, "")) })} className={input} />
                  <input aria-label="単位" value={draft.unit ?? ""} placeholder="本" onChange={(e) => setDraft({ ...draft, unit: e.target.value || null })} className="w-14 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                </span>
              </label>
              {AMOUNT_LABEL[draft.category] && (
                <label className="text-xs text-slate-600">
                  {AMOUNT_LABEL[draft.category]}
                  <input aria-label="1つあたりの量" inputMode="decimal" value={draft.amountPerUnit ?? ""} onChange={(e) => setDraft({ ...draft, amountPerUnit: e.target.value === "" ? null : Number(e.target.value) || null })} className={input} />
                </label>
              )}
              <label className="text-xs text-slate-600">
                期限
                <input aria-label="期限" type="date" value={draft.expiresOn ?? ""} onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value || null })} className={input} />
              </label>
              <label className="text-xs text-slate-600">
                置き場所
                <input aria-label="置き場所" value={draft.place ?? ""} onChange={(e) => setDraft({ ...draft, place: e.target.value || null })} className={input} />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "save" ? "保存しています…" : draft.id ? "直す" : "記録する"}
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
        <h2 className="font-semibold">備蓄品({data.items.length}件)</h2>
        {items.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{i.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{CATEGORIES[i.category]}</span>
                <span>
                  {i.quantity.toLocaleString()}
                  {i.unit ?? ""}
                  {i.category === "WATER" && i.amountPerUnit ? `(${i.amountPerUnit}L)` : ""}
                  {i.category === "FOOD" && i.amountPerUnit && i.amountPerUnit !== 1 ? `(1${i.unit ?? "つ"}${i.amountPerUnit}食)` : ""}
                  {i.category === "TOILET" && i.amountPerUnit && i.amountPerUnit !== 1 ? `(1${i.unit ?? "つ"}${i.amountPerUnit}回)` : ""}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${i.state === "EXPIRED" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : i.state === "SOON" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-slate-100 text-slate-600"}`}>
                  {i.state === "EXPIRED" ? `${ymd(i.expiresOn)}に切れています` : i.state === "SOON" ? `${ymd(i.expiresOn)}まで(あと${i.days}日)` : ymd(i.expiresOn)}
                </span>
                {i.place && <span className="text-xs text-slate-500">{i.place}</span>}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => setDraft({ id: i.id, name: i.name, category: i.category, quantity: i.quantity, unit: i.unit, amountPerUnit: i.amountPerUnit, expiresOn: i.expiresOn, place: i.place })} className="text-xs text-indigo-700 hover:underline">
                    直す(入れかえ)
                  </button>
                  <button onClick={() => remove(i)} disabled={busy === i.id} className="text-xs text-slate-400 hover:text-rose-700">
                    消す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">まだ記録はありません。</p>
        )}
      </section>
    </div>
  );
}
