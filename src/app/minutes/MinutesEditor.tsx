"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionItem, MinutesDraft } from "@/lib/minutes";

type Form = { title: string; heldOn: string; place: string; attendees: string; agenda: string; discussion: string; decisions: string; actions: ActionItem[]; mode: "claude" | "template" };

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const toForm = (d: MinutesDraft): Form => ({
  title: d.title,
  heldOn: d.heldOn,
  place: d.place ?? "",
  attendees: d.attendees.join("、"),
  agenda: d.content.agenda.join("\n"),
  discussion: d.content.discussion.join("\n"),
  decisions: d.content.decisions.join("\n"),
  actions: d.content.actions.length ? d.content.actions : [],
  mode: d.mode,
});

// 議事録を作る・直す。id がなければ、メモを整えるところから始める
export default function MinutesEditor({ id, initial, initialNotes = "", today, ai }: { id?: string; initial?: MinutesDraft; initialNotes?: string; today: string; ai: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [heldOn, setHeldOn] = useState(initial?.heldOn ?? today);
  const [form, setForm] = useState<Form | null>(initial ? toForm(initial) : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }

  async function organize(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      setForm(toForm(await call("/api/minutes/draft", "POST", { notes, heldOn, useAi })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!form) return;
    setBusy("save");
    setError(null);
    try {
      const body = {
        title: form.title,
        heldOn: form.heldOn,
        place: form.place,
        attendees: form.attendees,
        content: { agenda: lines(form.agenda), discussion: lines(form.discussion), decisions: lines(form.decisions), actions: form.actions.filter((a) => a.task.trim()).map((a) => ({ task: a.task, owner: a.owner || null, due: a.due || null })) },
        notes,
        mode: form.mode,
      };
      const saved = await call(id ? `/api/minutes/${id}` : "/api/minutes", id ? "PUT" : "POST", body);
      router.push(`/minutes/${saved.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
      setBusy(null);
    }
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setAction = (i: number, patch: Partial<ActionItem>) => setForm((f) => (f ? { ...f, actions: f.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) } : f));
  const input = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";

  return (
    <div className="space-y-6">
      {!id && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="font-semibold">1. 会議のメモを貼る</h2>
          <p className="text-sm text-slate-600">箇条書き・走り書きのままで大丈夫です。「決定:」「TODO」「@担当」「10/20まで」などがあると、ひな形でも振り分けやすくなります。</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={10}
            maxLength={8000}
            placeholder={"件名: 10月の営業会議\n出席: 山田、佐藤、鈴木\n# 新商品の値付け\n・新商品は1個480円で様子を見る\n決定: 年末は土日も営業する\nTODO 仕入先に見積もりを依頼する @佐藤 10/20まで"}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="text-slate-700">会議の日</span>
              <input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-1.5" />
            </label>
            <button onClick={() => organize(false)} disabled={!!busy || !notes.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "template" ? "整えています…" : "ひな形で整える"}
            </button>
            {ai && (
              <button onClick={() => organize(true)} disabled={!!busy || !notes.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "ai" ? "AIが整えています…" : "AIで整える"}
              </button>
            )}
          </div>
        </section>
      )}
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}

      {form && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{id ? "議事録を直す" : "2. 確かめて保存する"}</h2>
            {!id && <span className="text-xs text-slate-500">{form.mode === "claude" ? "AIが整えました。" : "ひな形で振り分けました。"}違うところは直してください</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-700">会議の名前</span>
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={100} className={`mt-1 ${input}`} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">日付</span>
              <input type="date" value={form.heldOn} onChange={(e) => set({ heldOn: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">場所</span>
              <input value={form.place} onChange={(e) => set({ place: e.target.value })} maxLength={60} className={`mt-1 ${input}`} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-700">出席者(「、」で区切る)</span>
              <input value={form.attendees} onChange={(e) => set({ attendees: e.target.value })} className={`mt-1 ${input}`} />
            </label>
          </div>
          {(
            [
              ["agenda", "議題"],
              ["decisions", "決まったこと"],
              ["discussion", "話し合ったこと"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm">
              <span className="text-slate-700">{label}(1行に1つ)</span>
              <textarea value={form[key]} onChange={(e) => set({ [key]: e.target.value })} rows={Math.max(2, lines(form[key]).length + 1)} className={`mt-1 field-sizing-content leading-6 ${input}`} />
            </label>
          ))}
          <div className="text-sm">
            <span className="text-slate-700">やること</span>
            <ul className="mt-1 space-y-2">
              {form.actions.map((a, i) => (
                <li key={i} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_8rem_10rem_auto] sm:border-0 sm:p-0">
                  <input value={a.task} onChange={(e) => setAction(i, { task: e.target.value })} placeholder="やること" aria-label="やること" className={input} />
                  <input value={a.owner ?? ""} onChange={(e) => setAction(i, { owner: e.target.value })} placeholder="担当" aria-label="担当" className={input} />
                  <input type="date" value={a.due ?? ""} onChange={(e) => setAction(i, { due: e.target.value || null })} aria-label="期限" className={input} />
                  <button onClick={() => set({ actions: form.actions.filter((_, j) => j !== i) })} className="justify-self-start rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-rose-700">
                    消す
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => set({ actions: [...form.actions, { task: "", owner: null, due: null }] })} className="mt-2 text-sm text-indigo-700 hover:underline">
              ＋ やることを足す
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "save" ? "保存しています…" : "保存する"}
            </button>
            {id && (
              <button onClick={() => router.push(`/minutes/${id}`)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                やめる
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
