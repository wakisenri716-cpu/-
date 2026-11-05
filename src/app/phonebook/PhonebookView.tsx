"use client";

import { useState } from "react";

type Entry = { id: string; name: string; userId: string | null; department: string | null; extension: string | null; direct: string | null; mobile: string | null; note: string | null };
type Data = { count: number; items: Entry[]; groups: { department: string | null; entries: Entry[] }[] };
type Draft = Omit<Entry, "id">;
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";

export default function PhonebookView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
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
  const load = async (query = q.trim()) => setData(await call(`/api/phonebook${query ? `?q=${encodeURIComponent(query)}` : ""}`, "GET"));
  const parse = () =>
    run("parse", async () => {
      const r = await call("/api/phonebook", "POST", { action: "parse", text });
      setDrafts(r.drafts);
      setSkipped(r.skipped);
    });
  const save = () =>
    run("save", async () => {
      if (!drafts) return;
      const r = await call("/api/phonebook", "POST", { entries: drafts });
      setFlash(`${r.saved}件を電話帳に入れました`);
      setDrafts(null);
      setSkipped([]);
      setText("");
      await load("");
    });
  const edit = (e: Entry) => {
    setDrafts([{ name: e.name, userId: e.userId, department: e.department, extension: e.extension, direct: e.direct, mobile: e.mobile, note: e.note }]);
    setSkipped([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const remove = (e: Entry) =>
    run(e.id, async () => {
      if (!confirm(`${e.name}を電話帳から消しますか?`)) return;
      await call(`/api/phonebook/${e.id}`, "DELETE");
      await load();
    });
  const set = (i: number, k: keyof Draft, v: string) => drafts && setDrafts(drafts.map((d, j) => (j === i ? { ...d, [k]: v || null } : d)));

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"例:\n山田 花子 経理 内線201 携帯 090-1234-5678\n受付 100\n会議室A 内線 410"} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button onClick={parse} disabled={!!busy || !text.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {busy === "parse" ? "読み取っています…" : "読み取る"}
        </button>
        {drafts && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="hidden grid-cols-6 gap-2 text-xs text-slate-500 lg:grid">
              <span>名前・場所</span>
              <span>部署</span>
              <span>内線</span>
              <span>直通</span>
              <span>社用携帯</span>
              <span>メモ</span>
            </div>
            {drafts.map((d, i) => (
              <div key={i} className="grid gap-2 border-b border-slate-100 pb-2 sm:grid-cols-3 lg:grid-cols-6 lg:border-0 lg:pb-0">
                <input aria-label="名前・場所" value={d.name} onChange={(e) => set(i, "name", e.target.value)} className={input} />
                <input aria-label="部署" placeholder="部署" value={d.department ?? ""} onChange={(e) => set(i, "department", e.target.value)} className={input} />
                <input aria-label="内線" placeholder="内線" inputMode="numeric" value={d.extension ?? ""} onChange={(e) => set(i, "extension", e.target.value)} className={input} />
                <input aria-label="直通" placeholder="直通" inputMode="tel" value={d.direct ?? ""} onChange={(e) => set(i, "direct", e.target.value)} className={input} />
                <input aria-label="社用携帯" placeholder="社用携帯" inputMode="tel" value={d.mobile ?? ""} onChange={(e) => set(i, "mobile", e.target.value)} className={input} />
                <input aria-label="メモ" placeholder="メモ" value={d.note ?? ""} onChange={(e) => set(i, "note", e.target.value)} className={input} />
              </div>
            ))}
            {!!skipped.length && <p className="text-xs text-amber-800">番号が見つからず読み飛ばした行: {skipped.join(" / ")}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={!!busy || !drafts.length} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {drafts.length}件を電話帳に入れる
              </button>
              <button onClick={() => (setDrafts(null), setSkipped([]))} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
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
          <h2 className="font-semibold">電話帳({data.count}件)</h2>
          <input aria-label="探す" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run("q", () => load())} placeholder="名前・部署・番号で探す" className="ml-auto w-56 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        {data.groups.length ? (
          data.groups.map((g) => (
            <div key={g.department ?? "-"} className="mt-3">
              <h3 className="text-xs font-semibold text-slate-500">{g.department ?? "部署なし・場所"}</h3>
              <ul className="divide-y divide-slate-100">
                {g.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                    <span className="min-w-28 font-medium">{e.name}</span>
                    {e.extension && <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">内線 {e.extension}</span>}
                    {e.direct && <span className="text-xs text-slate-600">直通 {e.direct}</span>}
                    {e.mobile && <span className="text-xs text-slate-600">携帯 {e.mobile}</span>}
                    {e.note && <span className="text-xs text-slate-500">{e.note}</span>}
                    <span className="ml-auto flex gap-3">
                      <button onClick={() => edit(e)} className="text-xs text-indigo-700 hover:underline">
                        直す
                      </button>
                      <button onClick={() => remove(e)} disabled={busy === e.id} className="text-xs text-slate-400 hover:text-rose-700">
                        消す
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="mt-2 text-slate-500">{q ? "見つかりませんでした。" : "まだ入っていません。上に貼り付けて入れてください。"}</p>
        )}
      </section>
    </div>
  );
}
