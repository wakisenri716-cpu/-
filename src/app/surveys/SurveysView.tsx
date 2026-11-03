"use client";

import { useState } from "react";

type Kind = "CHOICE" | "MULTI" | "SCALE" | "TEXT";
type Q = { id: string; kind: Kind; label: string; options?: string[] };
type Row = { id: string; title: string; anonymous: boolean; deadline: string | null; open: boolean; responses: number; createdAt: string };
type Result = Q & { answered: number; counts?: { option: string; count: number; names: string[] }[]; average?: number | null; dist?: number[]; texts?: { text: string; name: string | null }[]; hidden?: boolean };
type Detail = { id: string; title: string; anonymous: boolean; deadline: string | null; open: boolean; responses: number; total: number; waiting: string[] | null; results: Result[]; showText: boolean };

const KINDS: Record<Kind, string> = { CHOICE: "1つ選ぶ", MULTI: "いくつでも選ぶ", SCALE: "5段階", TEXT: "自由に書く" };
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function SurveysView({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [purpose, setPurpose] = useState("");
  const [draft, setDraft] = useState<{ title: string; description: string; questions: Q[]; anonymous: boolean; deadline: string; mode: string } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [summary, setSummary] = useState<{ summary: string; points: string[] } | null>(null);
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
  const makeDraft = (useAi: boolean) =>
    run(useAi ? "ai" : "draft", async () => {
      const d = await call("/api/surveys", "POST", { action: "draft", purpose, useAi });
      setDraft({ title: d.title, description: "", questions: d.questions, anonymous: true, deadline: "", mode: d.mode });
      if (useAi) setFlash(d.mode === "claude" ? `AIが質問を考えました${d.removed ? `(大切な個人情報を聞く質問など${d.removed}問を外しました)` : ""}。送る前に読んで直してください` : "AIの案が使えなかったので、決まった質問にしました");
    });
  const setQ = (i: number, patch: Partial<Q>) => draft && setDraft({ ...draft, questions: draft.questions.map((q, k) => (k === i ? { ...q, ...patch } : q)) });
  const send = () =>
    run("send", async () => {
      if (!draft || !confirm("社員全員にアンケートを送ります。よろしいですか?")) return;
      const r = await call("/api/surveys", "POST", { title: draft.title, description: draft.description, questions: draft.questions, anonymous: draft.anonymous, deadline: draft.deadline });
      setDraft(null);
      setPurpose("");
      setFlash(`${r.people}人にアンケートを送りました(メール${r.sent}通)`);
      setRows((await call("/api/surveys", "GET")).surveys);
    });
  const open = (id: string) =>
    run(`open-${id}`, async () => {
      setSummary(null);
      setDetail(await call(`/api/surveys/${id}`, "GET"));
    });
  const close = () =>
    run("close", async () => {
      if (!detail || !confirm("このアンケートを締め切りますか?")) return;
      await call(`/api/surveys/${detail.id}`, "PATCH", { action: "close" });
      setRows((await call("/api/surveys", "GET")).surveys);
      setDetail(await call(`/api/surveys/${detail.id}`, "GET"));
    });
  const remind = () =>
    run("remind", async () => {
      if (!detail) return;
      const r = await call(`/api/surveys/${detail.id}`, "PATCH", { action: "remind" });
      setFlash(r.waiting == null ? `まだ答えていない人にもう一度送りました(メール${r.sent}通)` : `まだ答えていない${r.waiting}人にもう一度送りました(メール${r.sent}通)`);
    });
  const summarize = () =>
    run("sum", async () => {
      if (!detail) return;
      setSummary(await call(`/api/surveys/${detail.id}`, "PATCH", { action: "summary" }));
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <h2 className="font-semibold">アンケートを作る</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="何を聞きたいか" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="何を聞きたいか(例: 忘年会の希望・在宅勤務の使いやすさ)" className={input} />
          <button onClick={() => makeDraft(false)} disabled={!!busy} className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-50">
            質問の案を作る
          </button>
          <button onClick={() => makeDraft(true)} disabled={!!busy || !purpose.trim()} className="shrink-0 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50">
            {busy === "ai" ? "AIが考えています…" : "AIで質問を考える"}
          </button>
        </div>
        {draft && (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <input aria-label="題" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${input} font-medium`} />
            <textarea aria-label="説明" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} placeholder="説明(任意)" className={input} />
            <ol className="space-y-2">
              {draft.questions.map((q, i) => (
                <li key={i} className="space-y-1.5 rounded-md bg-slate-50 p-2">
                  <div className="flex flex-wrap gap-2">
                    <span className="pt-1.5 text-xs text-slate-500">{i + 1}.</span>
                    <input aria-label={`質問${i + 1}`} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                    <select aria-label={`質問${i + 1}の種類`} value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value as Kind, options: e.target.value === "CHOICE" || e.target.value === "MULTI" ? (q.options?.length ? q.options : ["はい", "いいえ"]) : undefined })} className="rounded-md border border-slate-300 px-1.5 py-1 text-sm">
                      {(Object.keys(KINDS) as Kind[]).map((k) => (
                        <option key={k} value={k}>
                          {KINDS[k]}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, k) => k !== i) })} className="text-xs text-slate-400 hover:text-rose-700">
                      消す
                    </button>
                  </div>
                  {(q.kind === "CHOICE" || q.kind === "MULTI") && <input aria-label={`質問${i + 1}の選択肢`} value={(q.options ?? []).join("、")} onChange={(e) => setQ(i, { options: e.target.value.split(/[、,]/).map((x) => x.trim()) })} placeholder="選択肢を「、」で区切って" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />}
                </li>
              ))}
            </ol>
            <button onClick={() => setDraft({ ...draft, questions: [...draft.questions, { id: `q${Date.now() % 100000}`, kind: "TEXT", label: "" }] })} className="text-xs text-indigo-700 hover:underline">
              + 質問を足す
            </button>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.anonymous} onChange={(e) => setDraft({ ...draft, anonymous: e.target.checked })} />
                名前を出さずに集計する
              </label>
              <label className="text-xs text-slate-600">
                締め切り
                <input aria-label="締め切り" type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
              </label>
              <button onClick={send} disabled={!!busy} className="ml-auto rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "send" ? "送っています…" : "社員に送る"}
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                やめる
              </button>
            </div>
          </div>
        )}
      </section>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">アンケート({rows.length}件)</h2>
        {rows.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <button onClick={() => open(r.id)} className="font-medium text-indigo-700 hover:underline">
                  {r.title}
                </button>
                <span className={`rounded-full px-2 py-0.5 text-xs ${r.open ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600"}`}>{r.open ? "受付中" : "締め切り"}</span>
                <span className="text-xs text-slate-500">
                  答え {r.responses}件{r.deadline ? `・${md(r.deadline)}まで` : ""}
                  {r.anonymous ? "・名前なし" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">まだアンケートはありません。</p>
        )}
      </section>

      {detail && (
        <section className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{detail.title}</h2>
            <span className="text-xs text-slate-500">
              {detail.total}人のうち{detail.responses}人が答えました{detail.anonymous ? "(名前なし)" : ""}
            </span>
            <span className="ml-auto flex gap-2">
              <button onClick={summarize} disabled={!!busy || !detail.showText} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-800 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "sum" ? "AIがまとめています…" : "AIで自由な答えをまとめる"}
              </button>
              {detail.open && detail.responses < detail.total && (
                <button onClick={remind} disabled={!!busy} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-50">
                  {busy === "remind" ? "送っています…" : "まだの人にもう一度送る"}
                </button>
              )}
              {detail.open && (
                <button onClick={close} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                  締め切る
                </button>
              )}
            </span>
          </div>
          {detail.waiting && detail.waiting.length > 0 && <p className="text-xs text-amber-900">まだ答えていない: {detail.waiting.join("、")}</p>}
          {summary && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
              <p className="text-xs text-indigo-700">AIのまとめ</p>
              <p className="mt-1">{summary.summary}</p>
              <ul className="mt-1 list-disc pl-5">
                {summary.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {detail.results.map((q, i) => (
            <div key={q.id} className="space-y-1.5">
              <p className="font-medium">
                {i + 1}. {q.label} <span className="text-xs font-normal text-slate-500">({q.answered}人)</span>
              </p>
              {q.counts && (
                <ul className="space-y-1">
                  {q.counts.map((c) => {
                    const pct = q.answered ? Math.round((c.count / q.answered) * 100) : 0;
                    return (
                      <li key={c.option} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-xs sm:grid-cols-[12rem_1fr_4rem]">
                        <span className="truncate">{c.option}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-right text-slate-600">{c.count}人</span>
                        {c.names.length > 0 && <span className="col-span-3 text-slate-500">{c.names.join("、")}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {q.dist && (
                <p className="text-xs text-slate-600">
                  平均 {q.average ?? "-"}(1〜5)・{q.dist.map((n, k) => `${k + 1}: ${n}人`).join(" / ")}
                </p>
              )}
              {q.hidden && <p className="text-xs text-slate-500">名前を出さないアンケートなので、3人以上答えると見られます。</p>}
              {q.texts && q.texts.length > 0 && (
                <ul className="space-y-1">
                  {q.texts.map((t, k) => (
                    <li key={k} className="rounded-md bg-slate-50 px-2 py-1.5">
                      {t.text}
                      {t.name && <span className="ml-2 text-xs text-slate-500">{t.name}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
