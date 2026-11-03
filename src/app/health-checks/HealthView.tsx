"use client";

import { useState } from "react";

type State = "DONE" | "PLANNED" | "PASSED" | "NOT_YET" | "DUE" | "MISSED";
type Kind = "REGULAR" | "HIRING" | "STRESS";
type Person = { staffId: string; name: string; state: State; doneOn: string | null; plannedOn: string | null; clinic: string | null; lastDone: string | null; stress: string | null; recordId: string | null };
type Record_ = { id: string; staffId: string; staffName: string; kind: Kind; plannedOn: string | null; doneOn: string | null; clinic: string | null; cost: number | null; followUp: boolean; followUpDoneOn: string | null; note: string | null };
type Data = { year: number; today: string; people: Person[]; followUps: { id: string; name: string; kind: Kind; doneOn: string | null; days: number | null }[]; records: Record_[]; counts: Record<State, number>; cost: number; started: boolean };
type Draft = { id?: string; staffId: string | null; staffName: string; kind: Kind; plannedOn: string | null; doneOn: string | null; clinic: string | null; cost: number | null; followUp: boolean; followUpDoneOn?: string | null; note?: string | null };

const KINDS: Record<Kind, string> = { REGULAR: "定期健康診断", HIRING: "雇入時健康診断", STRESS: "ストレスチェック" };
const STATES: Record<State, { label: string; cls: string }> = {
  DUE: { label: "1年以上受けていない・記録なし", cls: "bg-rose-50 text-rose-800 ring-1 ring-rose-200" },
  MISSED: { label: "受けた記録なし", cls: "bg-slate-100 text-slate-600" },
  PASSED: { label: "予約日を過ぎた", cls: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
  NOT_YET: { label: "今年まだ", cls: "bg-slate-100 text-slate-700" },
  PLANNED: { label: "予約済み", cls: "bg-sky-50 text-sky-800 ring-1 ring-sky-200" },
  DONE: { label: "受けた", cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" },
};
const ORDER: State[] = ["DUE", "PASSED", "NOT_YET", "MISSED", "PLANNED", "DONE"];
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const md = (k: string | null) => (k ? `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "");
const ymd = (k: string | null) => (k ? `${Number(k.slice(0, 4))}/${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : "");

export default function HealthView({ initial, staff }: { initial: Data; staff: { id: string; name: string }[] }) {
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
  const load = async (year = data.year) => setData(await call(`/api/health-checks?year=${year}`, "GET"));
  const parse = () => run("parse", async () => setDraft((await call("/api/health-checks", "POST", { action: "parse", text })).draft));
  const save = () =>
    run("save", async () => {
      if (!draft) return;
      const { record } = draft.id ? await call(`/api/health-checks/${draft.id}`, "PATCH", draft) : await call("/api/health-checks", "POST", draft);
      setFlash(`${record.staffName}さんの${KINDS[record.kind as Kind]}を${record.doneOn ? `受けた(${ymd(record.doneOn)})` : `予約(${ymd(record.plannedOn)})`}として記録しました`);
      setDraft(null);
      setText("");
      await load();
    });
  const followUpDone = (id: string, name: string) =>
    run(id, async () => {
      await call(`/api/health-checks/${id}`, "PATCH", { action: "followUpDone" });
      setFlash(`${name}さんの再検査を受けたことにしました`);
      await load();
    });
  const remove = (r: Record_) =>
    run(r.id, async () => {
      if (!confirm(`${r.staffName}さんの${KINDS[r.kind]}の記録を消しますか?`)) return;
      await call(`/api/health-checks/${r.id}`, "DELETE");
      await load();
    });
  const blank = (p: Person, kind: Kind = "REGULAR"): Draft => ({ staffId: p.staffId, staffName: p.name, kind, plannedOn: null, doneOn: null, clinic: null, cost: null, followUp: false });
  const people = [...data.people].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
  const thisYear = Number(data.today.slice(0, 4));

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 山田 11/20 健診 さくらクリニック 8,800円" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <label className="text-xs text-slate-600">
                受ける人
                <select aria-label="受ける人" value={draft.staffId ?? ""} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, staffId: e.target.value || null, staffName: staff.find((s) => s.id === e.target.value)?.name ?? "" })} className={input}>
                  <option value="">選ぶ</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                種類
                <select aria-label="種類" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })} className={input}>
                  {(Object.keys(KINDS) as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KINDS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                予約日
                <input aria-label="予約日" type="date" value={draft.plannedOn ?? ""} onChange={(e) => setDraft({ ...draft, plannedOn: e.target.value || null })} className={input} />
              </label>
              <label className="text-xs text-slate-600">
                受けた日
                <input aria-label="受けた日" type="date" value={draft.doneOn ?? ""} max={data.today} onChange={(e) => setDraft({ ...draft, doneOn: e.target.value || null })} className={input} />
              </label>
              <label className="text-xs text-slate-600">
                病院・健診センター
                <input aria-label="病院" value={draft.clinic ?? ""} onChange={(e) => setDraft({ ...draft, clinic: e.target.value || null })} className={input} />
              </label>
              <label className="text-xs text-slate-600">
                費用(円)
                <input aria-label="費用" inputMode="numeric" value={draft.cost ?? ""} onChange={(e) => setDraft({ ...draft, cost: e.target.value ? Number(e.target.value.replace(/[^\d]/g, "")) || null : null })} className={input} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.followUp} onChange={(e) => setDraft({ ...draft, followUp: e.target.checked })} />
                再検査・精密検査が必要と言われた
              </label>
              {draft.followUp && (
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  再検査を受けた日
                  <input aria-label="再検査を受けた日" type="date" value={draft.followUpDoneOn ?? ""} max={data.today} onChange={(e) => setDraft({ ...draft, followUpDoneOn: e.target.value || null })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
              )}
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

      {data.followUps.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-amber-900">再検査・精密検査がまだの人</h2>
          <p className="mt-1 text-xs text-amber-900/80">本人に、受けるよう声をかけてください。受けたら「受けた」を押します(結果の中身は聞かなくてかまいません)。</p>
          <ul className="mt-2 space-y-1">
            {data.followUps.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-amber-900">
                  {KINDS[f.kind]}
                  {f.doneOn ? `(${ymd(f.doneOn)}に受けた${f.days ? `・${f.days}日たちました` : ""})` : ""}
                </span>
                <button onClick={() => followUpDone(f.id, f.name)} disabled={busy === f.id} className="ml-auto rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100">
                  再検査を受けた
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{data.year}年の受診状況(在籍 {data.people.length}人)</h2>
          <span className="flex gap-1">
            <button onClick={() => run("year", () => load(data.year - 1))} className="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
              ← {data.year - 1}年
            </button>
            {data.year < thisYear && (
              <button onClick={() => run("year", () => load(data.year + 1))} className="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
                {data.year + 1}年 →
              </button>
            )}
          </span>
          <span className="ml-auto flex flex-wrap gap-1.5 text-xs">
            {ORDER.filter((s) => data.counts[s]).map((s) => (
              <span key={s} className={`rounded-full px-2 py-0.5 ${STATES[s].cls}`}>
                {STATES[s].label} {data.counts[s]}人
              </span>
            ))}
          </span>
        </div>
        {people.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {people.map((p) => (
              <li key={p.staffId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{p.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATES[p.state].cls}`}>{STATES[p.state].label}</span>
                <span className="text-xs text-slate-600">
                  {p.doneOn ? `${md(p.doneOn)}に受けた` : p.plannedOn ? `予約 ${md(p.plannedOn)}` : p.lastDone ? `前回 ${ymd(p.lastDone)}` : "記録なし"}
                  {p.clinic ? `・${p.clinic}` : ""}
                </span>
                {p.stress && <span className="text-xs text-slate-500">ストレスチェック: {p.stress}</span>}
                <span className="ml-auto flex gap-2">
                  {p.state !== "DONE" && (
                    <button
                      onClick={() => {
                        const r = p.recordId ? data.records.find((x) => x.id === p.recordId) : null;
                        setDraft(r ? { ...r, doneOn: data.today } : { ...blank(p), doneOn: data.today });
                      }}
                      className="text-xs text-indigo-700 hover:underline"
                    >
                      受けた
                    </button>
                  )}
                  {p.state !== "DONE" && p.state !== "PLANNED" && (
                    <button onClick={() => setDraft(blank(p))} className="text-xs text-indigo-700 hover:underline">
                      予約を入れる
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">在籍している人がいません。先に「スタッフ」に社員を登録してください。</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">
          {data.year}年の記録({data.records.length}件{data.cost ? `・費用 ${data.cost.toLocaleString()}円` : ""})
        </h2>
        {data.records.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{r.staffName}</span>
                <span>{KINDS[r.kind]}</span>
                <span className="text-xs text-slate-600">{r.doneOn ? `${ymd(r.doneOn)}に受けた` : `予約 ${ymd(r.plannedOn)}`}</span>
                {r.clinic && <span className="text-xs text-slate-500">{r.clinic}</span>}
                {r.cost != null && <span className="text-xs text-slate-500">{r.cost.toLocaleString()}円</span>}
                {r.followUp && <span className={`rounded-full px-2 py-0.5 text-xs ${r.followUpDoneOn ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"}`}>{r.followUpDoneOn ? `再検査 ${md(r.followUpDoneOn)}に受けた` : "再検査まだ"}</span>}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => setDraft({ ...r })} className="text-xs text-indigo-700 hover:underline">
                    直す
                  </button>
                  <button onClick={() => remove(r)} disabled={busy === r.id} className="text-xs text-slate-400 hover:text-rose-700">
                    消す
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">この年の記録はまだありません。</p>
        )}
      </section>
    </div>
  );
}
