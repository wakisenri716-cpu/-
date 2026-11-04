"use client";

import { useState } from "react";

type Person = { id: string; name: string };
type Role = { id: string; name: string; weekdays: number[]; weekdayLabel: string; members: Person[]; startDate: string; note: string | null; schedule: { date: string; userId: string; name: string; swapped: boolean }[] };
type Data = { today: string; people: Person[]; roles: Role[] };
type Draft = { id?: string; name: string; weekdays: number[]; memberIds: string[]; startDate?: string; note?: string | null; unknown?: string[] };
const DAYS = "日月火水木金土";
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${DAYS[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

export default function DutiesView({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
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
  const load = async () => setData(await call("/api/duties", "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/duties", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      if (draft.id) await call(`/api/duties/${draft.id}`, "PATCH", draft);
      else await call("/api/duties", "POST", draft);
      setFlash(`${draft.name}の当番を${draft.id ? "直しました" : "作りました"}`);
      setDraft(null);
      setText("");
      await load();
    });
  const swap = (r: Role, date: string, userId: string) =>
    run(`${r.id}-${date}`, async () => {
      await call(`/api/duties/${r.id}`, "PATCH", { action: "swap", date, userId });
      await load();
    });
  const remove = (r: Role) =>
    run(r.id, async () => {
      if (!confirm(`${r.name}の当番を消しますか?`)) return;
      await call(`/api/duties/${r.id}`, "DELETE");
      await load();
    });
  const toggleDay = (d: number) => draft && setDraft({ ...draft, weekdays: draft.weekdays.includes(d) ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d].sort() });
  const move = (i: number, by: number) => {
    if (!draft) return;
    const ids = [...draft.memberIds];
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setDraft({ ...draft, memberIds: ids });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 掃除 月水金 山田・佐藤・鈴木" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-600">
                当番の名前
                <input aria-label="当番の名前" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="block w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <div className="text-xs text-slate-600">
                曜日
                <div className="mt-0.5 flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <button key={d} onClick={() => toggleDay(d)} aria-pressed={draft.weekdays.includes(d)} className={`h-8 w-8 rounded-md border text-sm ${draft.weekdays.includes(d) ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-900" : "border-slate-300"}`}>
                      {DAYS[d]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs text-slate-600">
                メモ(任意)
                <input aria-label="メモ" value={draft.note ?? ""} placeholder="例: 給湯室のゴミも" onChange={(e) => setDraft({ ...draft, note: e.target.value || null })} className="block w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <div className="text-xs text-slate-600">
              回す順
              <ol className="mt-1 space-y-1">
                {draft.memberIds.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right text-xs text-slate-400">{i + 1}.</span>
                    <span className="min-w-[8rem]">{data.people.find((p) => p.id === id)?.name}</span>
                    <button onClick={() => move(i, -1)} className="text-xs text-slate-500 hover:text-slate-800" aria-label="上へ">
                      ↑
                    </button>
                    <button onClick={() => move(i, 1)} className="text-xs text-slate-500 hover:text-slate-800" aria-label="下へ">
                      ↓
                    </button>
                    <button onClick={() => setDraft({ ...draft, memberIds: draft.memberIds.filter((x) => x !== id) })} className="text-xs text-slate-400 hover:text-rose-700">
                      外す
                    </button>
                  </li>
                ))}
              </ol>
              <select aria-label="人を足す" value="" onChange={(e) => e.target.value && setDraft({ ...draft, memberIds: [...draft.memberIds, e.target.value] })} className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="">+ 人を足す</option>
                {data.people
                  .filter((p) => !draft.memberIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              {!!draft.unknown?.length && <p className="mt-1 text-amber-800">わからなかった名前: {draft.unknown.join("、")}(社内の人から選んでください)</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {draft.id ? "直す" : "当番を作る"}
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

      {data.roles.map((r) => (
        <section key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{r.name}</h2>
            <span className="text-xs text-slate-500">
              {r.weekdayLabel}・{r.members.map((m) => m.name).join(" → ")}
              {r.note ? `・${r.note}` : ""}
            </span>
            <span className="ml-auto flex gap-2">
              <button onClick={() => setDraft({ id: r.id, name: r.name, weekdays: r.weekdays, memberIds: r.members.map((m) => m.id), startDate: r.startDate, note: r.note })} className="text-xs text-indigo-700 hover:underline">
                直す
              </button>
              <button onClick={() => remove(r)} disabled={busy === r.id} className="text-xs text-slate-400 hover:text-rose-700">
                消す
              </button>
            </span>
          </div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {r.schedule.map((s) => (
              <li key={s.date} className={`flex items-center gap-2 rounded-md px-2 py-1 ${s.date === data.today ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50"}`}>
                <span className="w-16 text-xs tabular-nums text-slate-600">{md(s.date)}</span>
                <select aria-label={`${md(s.date)}の当番`} value={s.userId} disabled={!!busy} onChange={(e) => swap(r, s.date, e.target.value)} className={`min-w-0 flex-1 rounded border bg-white px-1 py-0.5 text-sm ${s.swapped ? "border-indigo-300 text-indigo-900" : "border-transparent"}`}>
                  {data.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {s.swapped && (
                  <button onClick={() => swap(r, s.date, "")} className="text-xs text-slate-400 hover:text-slate-700" aria-label="元に戻す">
                    戻す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!data.roles.length && <p className="text-sm text-slate-500">まだ当番はありません。</p>}
    </div>
  );
}
