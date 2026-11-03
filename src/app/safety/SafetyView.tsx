"use client";

import { useState } from "react";

type Answer = { userId: string; name: string; status: "SAFE" | "INJURED" | "HELP"; canWork: "YES" | "LATER" | "REMOTE" | "NO"; note: string | null; at: string };
type Check = { id: string; title: string; message: string; createdByName: string; createdAt: string; closedAt: string | null; drill: boolean; speed: { median: number | null; within30: number; within60: number; slowest: number | null; total: number }; answers: Answer[]; waiting: { id: string; name: string; email: boolean }[]; counts: { total: number; answered: number; safe: number; injured: number; help: number; canWork: number } };

const STATUS = { SAFE: { label: "無事", cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" }, INJURED: { label: "けがをした", cls: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" }, HELP: { label: "助けが必要", cls: "bg-rose-50 text-rose-800 ring-1 ring-rose-200" } };
const WORK = { YES: "出社できる", LATER: "遅れて出社", REMOTE: "家で仕事できる", NO: "出社できない" };
const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const when = (s: string) => new Date(s).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function SafetyView({ initial }: { initial: Check[] }) {
  const [checks, setChecks] = useState(initial);
  const [situation, setSituation] = useState("");
  const [drill, setDrill] = useState(false);
  const [draft, setDraft] = useState<{ title: string; message: string; mode: string } | null>(null);
  const [summary, setSummary] = useState<Record<string, { text: string; mode: string }>>({});
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
  const load = async () => setChecks((await call("/api/safety", "GET")).checks);
  const makeDraft = (useAi: boolean) =>
    run(useAi ? "ai" : "draft", async () => {
      const d = await call("/api/safety", "POST", { action: "draft", situation, useAi, drill });
      setDraft(d);
      if (useAi && d.mode !== "claude") setFlash("AIの文が条件に合わなかったので、決まった文のままにしました");
    });
  const start = () =>
    run("start", async () => {
      if (!draft || !confirm(drill ? "社員全員に安否確認の訓練を送ります。よろしいですか?" : "社員全員に安否確認を送ります。よろしいですか?")) return;
      const r = await call("/api/safety", "POST", { title: draft.title, message: draft.message, drill });
      setDraft(null);
      setSituation("");
      setFlash(`${r.people}人に安否確認を送りました(メール${r.sent}通・アプリを入れている人には通知も)`);
      await load();
    });
  const act = (c: Check, action: string, useAi = false) =>
    run(`${c.id}-${action}${useAi ? "-ai" : ""}`, async () => {
      if (action === "close" && !confirm("この安否確認を締めますか?(締めると答えられなくなります)")) return;
      const r = await call(`/api/safety/${c.id}`, "PATCH", { action, useAi });
      if (action === "summary") {
        setSummary({ ...summary, [c.id]: { text: r.summary, mode: r.mode } });
        if (useAi && r.mode !== "claude") setFlash("AIのまとめが条件に合わなかったので、決まった文にしました");
        return;
      }
      if (action === "remind") setFlash(`まだ答えていない${r.waiting}人にもう一度送りました(メール${r.sent}通)`);
      await load();
    });
  const open = checks.find((c) => !c.closedAt);

  return (
    <div className="space-y-6">
      {!open && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
          <h2 className="font-semibold">安否確認を始める</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input aria-label="何があったか" value={situation} onChange={(e) => setSituation(e.target.value)} placeholder="何があったか(例: 地震・台風10号・大雨)" className={input} />
            <label className="flex shrink-0 items-center gap-1.5 text-xs">
              <input type="checkbox" checked={drill} onChange={(e) => { setDrill(e.target.checked); setDraft(null); }} />
              訓練として送る
            </label>
            <button onClick={() => makeDraft(false)} disabled={!!busy} className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-50">
              文を作る
            </button>
          </div>
          <p className="text-xs text-slate-500">ふだんの練習には「訓練として送る」を使ってください。題と本文に「訓練」と入り、答えるまでの時間を集計します。</p>
          {draft && (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => makeDraft(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-800 hover:bg-indigo-100 disabled:opacity-50">
                  {busy === "ai" ? "AIが整えています…" : "AIで文を整える"}
                </button>
                {draft.mode === "claude" && <span className="text-xs text-indigo-700">AIが整えました。送る前に読んでください</span>}
              </div>
              <input aria-label="題" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={input} />
              <textarea aria-label="本文" value={draft.message} rows={8} onChange={(e) => setDraft({ ...draft, message: e.target.value })} className={input} />
              <p className="text-xs text-slate-500">送るときに、答える画面へのリンクを足します。</p>
              <div className="flex gap-2">
                <button onClick={start} disabled={!!busy} className={`rounded-md px-4 py-2 font-medium text-white disabled:opacity-50 ${drill ? "bg-amber-600 hover:bg-amber-700" : "bg-rose-600 hover:bg-rose-700"}`}>
                  {busy === "start" ? "送っています…" : drill ? "訓練を全員に送る" : "全員に送る"}
                </button>
                <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
                  やめる
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}

      {checks.map((c) => (
        <section key={c.id} className={`space-y-3 rounded-xl border bg-white p-4 text-sm shadow-sm ${c.closedAt ? "border-slate-200" : "border-rose-200"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{c.title}</h2>
            <span className="text-xs text-slate-500">
              {when(c.createdAt)} {c.createdByName}
              {c.closedAt ? `・${when(c.closedAt)}に締めた` : ""}
            </span>
            {c.drill && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200">訓練</span>}
            {!c.closedAt && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-800 ring-1 ring-rose-200">受付中</span>}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">
              答えた {c.counts.answered} / {c.counts.total}人
            </span>
            <span className={`rounded-full px-2 py-0.5 ${STATUS.SAFE.cls}`}>無事 {c.counts.safe}</span>
            {c.counts.injured > 0 && <span className={`rounded-full px-2 py-0.5 ${STATUS.INJURED.cls}`}>けが {c.counts.injured}</span>}
            {c.counts.help > 0 && <span className={`rounded-full px-2 py-0.5 ${STATUS.HELP.cls}`}>助けが必要 {c.counts.help}</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5">出社できる(遅れ・在宅も) {c.counts.canWork}</span>
          </div>
          {c.speed.median != null && (
            <p className="text-xs text-slate-600">
              答えるまでの時間: 真ん中の人 {c.speed.median}分・30分以内 {c.speed.within30}人・1時間以内 {c.speed.within60}人(いちばん遅い人 {c.speed.slowest}分)
            </p>
          )}
          {c.waiting.length > 0 && (
            <div className="rounded-md bg-amber-50/70 p-3">
              <p className="text-xs font-medium text-amber-900">まだ答えていない人({c.waiting.length}人)</p>
              <p className="mt-1 text-amber-900">{c.waiting.map((p) => `${p.name}${p.email ? "" : "(メールなし)"}`).join("、")}</p>
            </div>
          )}
          {c.answers.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {c.answers.map((a) => (
                <li key={a.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{a.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
                  <span className="text-xs text-slate-600">{WORK[a.canWork]}</span>
                  {a.note && <span className="text-xs text-slate-700">「{a.note}」</span>}
                  <span className="ml-auto text-xs text-slate-400">{when(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {summary[c.id] && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
              <p className="text-xs text-indigo-700">{summary[c.id].mode === "claude" ? "AIのまとめ" : "まとめ"}</p>
              <p className="mt-1 whitespace-pre-line">{summary[c.id].text}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => act(c, "summary")} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
              まとめる
            </button>
            {c.answers.length > 0 && (
              <button onClick={() => act(c, "summary", true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-800 hover:bg-indigo-100">
                {busy === `${c.id}-summary-ai` ? "AIがまとめています…" : "AIでまとめる"}
              </button>
            )}
            {!c.closedAt && c.waiting.length > 0 && (
              <button onClick={() => act(c, "remind")} disabled={!!busy} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-50">
                まだの人にもう一度送る
              </button>
            )}
            {!c.closedAt && (
              <button onClick={() => act(c, "close")} disabled={!!busy} className="ml-auto rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
                締める
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
