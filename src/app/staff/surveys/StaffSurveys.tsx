"use client";

import { useEffect, useState } from "react";

type Q = { id: string; kind: "CHOICE" | "MULTI" | "SCALE" | "TEXT"; label: string; options?: string[] };
type Survey = { id: string; title: string; description: string | null; questions: Q[]; anonymous: boolean; deadline: string | null; mine: Record<string, unknown> | null };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export function StaffSurveys() {
  const [list, setList] = useState<Survey[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/surveys")
      .then((r) => (r.ok ? r.json() : { surveys: [] }))
      .then((d) => {
        setList(d.surveys ?? []);
        setAnswers(Object.fromEntries((d.surveys ?? []).map((s: Survey) => [s.id, s.mine ?? {}])));
      })
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);

  async function send(id: string) {
    setBusy(id);
    setMsg(null);
    const res = await fetch("/api/staff-app/surveys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ surveyId: id, answers: answers[id] }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: json.error || "送れませんでした" });
    setMsg({ ok: true, text: "答えを送りました。締め切りまでは直せます" });
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">社内アンケート</h1>
        <p className="mt-1 text-sm text-slate-600">答えられる質問だけでかまいません。締め切りまでは答えを直せます。</p>
      </div>
      {list === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">いま答えるアンケートはありません。</p>
      ) : (
        list.map((s) => {
          const a = answers[s.id] ?? {};
          const set = (qid: string, v: unknown) => setAnswers({ ...answers, [s.id]: { ...a, [qid]: v } });
          return (
            <section key={s.id} className="space-y-4 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <div>
                <h2 className="font-semibold">{s.title}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {s.questions.length}問{s.deadline ? `・${md(s.deadline)}まで` : ""}・{s.anonymous ? "名前は出さずに集計します" : "名前つきで集計します"}
                  {s.mine ? "・答えました" : ""}
                </p>
                {s.description && <p className="mt-1 whitespace-pre-line text-slate-600">{s.description}</p>}
              </div>
              {s.questions.map((q, i) => (
                <div key={q.id} className="space-y-1.5">
                  <p className="font-medium">
                    {i + 1}. {q.label}
                  </p>
                  {q.kind === "CHOICE" && (
                    <div className="flex flex-wrap gap-2">
                      {q.options!.map((o) => (
                        <button key={o} onClick={() => set(q.id, o)} aria-pressed={a[q.id] === o} className={`rounded-xl border px-3 py-2 ${a[q.id] === o ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-900" : "border-slate-300"}`}>
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.kind === "MULTI" && (
                    <div className="flex flex-wrap gap-2">
                      {q.options!.map((o) => {
                        const cur = Array.isArray(a[q.id]) ? (a[q.id] as string[]) : [];
                        const on = cur.includes(o);
                        return (
                          <button key={o} onClick={() => set(q.id, on ? cur.filter((x) => x !== o) : [...cur, o])} aria-pressed={on} className={`rounded-xl border px-3 py-2 ${on ? "border-indigo-400 bg-indigo-50 font-medium text-indigo-900" : "border-slate-300"}`}>
                            {on ? "✓ " : ""}
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {q.kind === "SCALE" && (
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => set(q.id, n)} aria-pressed={a[q.id] === n} className={`rounded-xl border py-2.5 font-medium ${a[q.id] === n ? "border-indigo-400 bg-indigo-50 text-indigo-900" : "border-slate-300"}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.kind === "TEXT" && <textarea aria-label={q.label} value={String(a[q.id] ?? "")} onChange={(e) => set(q.id, e.target.value)} rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2" />}
                </div>
              ))}
              <button onClick={() => send(s.id)} disabled={busy === s.id} className="w-full rounded-xl bg-vermilion-600 px-3 py-3 font-semibold text-white disabled:opacity-50">
                {busy === s.id ? "送っています…" : s.mine ? "答えを直して送る" : "答えを送る"}
              </button>
            </section>
          );
        })
      )}
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
    </div>
  );
}
