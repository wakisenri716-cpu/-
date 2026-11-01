"use client";

import Link from "next/link";
import { useState } from "react";

type Question = { id: string; userName: string; question: string; aiReply: string | null; status: string; answer: string | null; answeredByName: string | null; answeredAt: string | null; manualId: string | null; createdAt: string };
type Draft = { answer: string; saveFaq: boolean; faqTitle: string; mode: "claude" | "template"; related: { id: string; title: string }[] };

const input = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const when = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });

export default function QuestionsView({ initial, ai }: { initial: Question[]; ai: boolean }) {
  const [questions, setQuestions] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(id: string, body: unknown) {
    const res = await fetch(`/api/staff-questions/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
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
  const draft = (q: Question, useAi: boolean) =>
    run(`${q.id}-${useAi ? "ai" : "make"}`, async () => {
      const d = await call(q.id, { action: "draft", useAi });
      setDrafts((all) => ({ ...all, [q.id]: { answer: d.answer, related: d.related, mode: d.mode, saveFaq: all[q.id]?.saveFaq ?? true, faqTitle: all[q.id]?.faqTitle ?? q.question.replace(/\s+/g, " ").slice(0, 80) } }));
    });
  const answer = (q: Question) =>
    run(`${q.id}-send`, async () => {
      const d = drafts[q.id];
      const r = await call(q.id, { action: "answer", answer: d.answer, saveFaq: d.saveFaq, faqTitle: d.faqTitle });
      setQuestions((list) => list.map((x) => (x.id === q.id ? r.question : x)));
      setFlash(`${q.userName}さんに答えました${r.mailed ? "(メールで知らせました)" : ""}${d.saveFaq ? "。よくある質問に足しました" : ""}`);
      setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== q.id)));
    });

  const open = questions.filter((q) => q.status === "OPEN");
  const done = questions.filter((q) => q.status !== "OPEN");
  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
      <section className="space-y-3">
        <h2 className="font-semibold">答え待ち({open.length}件)</h2>
        {open.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">答え待ちの質問はありません。</p>}
        {open.map((q) => {
          const d = drafts[q.id];
          return (
            <article key={q.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{q.userName}さん</p>
                <span className="text-xs text-slate-500">{when(q.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{q.question}</p>
              {q.aiReply && (
                <details className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <summary className="cursor-pointer">AIが答えた内容</summary>
                  <p className="mt-1 whitespace-pre-wrap">{q.aiReply}</p>
                </details>
              )}
              {!d ? (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => draft(q, false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                    答える
                  </button>
                  {ai && (
                    <button onClick={() => draft(q, true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                      {busy === `${q.id}-ai` ? "AIが書いています…" : "AIで答えの下書き"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    {d.mode === "claude" ? "AIがマニュアルをもとに書きました(直せます)" : "答えを書いてください"}
                    {d.related.length > 0 && (
                      <>
                        ・参考:{" "}
                        {d.related.map((m, i) => (
                          <span key={m.id}>
                            {i > 0 && "・"}
                            <Link href={`/staff/manuals/${m.id}`} className="text-indigo-700 underline">
                              {m.title}
                            </Link>
                          </span>
                        ))}
                      </>
                    )}
                  </p>
                  <textarea aria-label="答え" value={d.answer} onChange={(e) => setDrafts((all) => ({ ...all, [q.id]: { ...d, answer: e.target.value } }))} rows={8} className={`${input} leading-relaxed`} />
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={d.saveFaq} onChange={(e) => setDrafts((all) => ({ ...all, [q.id]: { ...d, saveFaq: e.target.checked } }))} />
                    <span>よくある質問に足す(次からAIが答えられます)</span>
                  </label>
                  {d.saveFaq && <input aria-label="よくある質問の題名" value={d.faqTitle} onChange={(e) => setDrafts((all) => ({ ...all, [q.id]: { ...d, faqTitle: e.target.value } }))} placeholder="よくある質問の題名" className={input} />}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => answer(q)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                      {busy === `${q.id}-send` ? "送っています…" : "この内容で答える"}
                    </button>
                    {ai && (
                      <button onClick={() => draft(q, true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                        {busy === `${q.id}-ai` ? "AIが書いています…" : "AIで書き直す"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
      {done.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold">答えたもの(30日)</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {done.map((q) => (
              <li key={q.id} className="space-y-1 py-2">
                <p>
                  <span className="font-medium">{q.userName}さん</span>: {q.question}
                </p>
                <p className="whitespace-pre-wrap text-slate-600">{q.answer}</p>
                <p className="text-xs text-slate-500">
                  {q.answeredByName}さんが答えました{q.answeredAt ? `(${when(q.answeredAt)})` : ""}
                  {q.manualId && (
                    <>
                      ・
                      <Link href={`/staff/manuals/${q.manualId}`} className="text-indigo-700 underline">
                        よくある質問
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
