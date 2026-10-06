"use client";

import { useState } from "react";
import type { Article, PolicyKind, POLICY_KINDS } from "@/lib/policyDrafts";
import { PrintButton } from "@/components/PrintButton";

type Kinds = typeof POLICY_KINDS;
type Draft = { kind: PolicyKind; title: string; company: string; articles: Article[]; checkpoints: string[]; mode: "claude" | "template" };

const ORDER: PolicyKind[] = ["expense", "telework", "condolence"];

function defaults(kinds: Kinds, kind: PolicyKind) {
  return Object.fromEntries(kinds[kind].fields.map((f) => [f.key, String(f.default)]));
}

export default function PolicyDraftView({ kinds, company, today, ai }: { kinds: Kinds; company: string; today: string; ai: boolean }) {
  const [kind, setKind] = useState<PolicyKind>("expense");
  const [inputs, setInputs] = useState<Record<string, string>>(() => defaults(kinds, "expense"));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"template" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spec = kinds[kind];

  function choose(k: PolicyKind) {
    setKind(k);
    setInputs(defaults(kinds, k));
    setDraft(null);
    setError(null);
  }

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      const res = await fetch("/api/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, inputs, effectiveDate, notes, useAi }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setDraft(body);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  function editArticle(i: number, patch: Partial<Article>) {
    setDraft((d) => (d ? { ...d, articles: d.articles.map((a, j) => (j === i ? { ...a, ...patch } : a)) } : d));
  }

  let n = 0;
  return (
    <div className="space-y-6">
      <div className="space-y-6 print:hidden">
        <div className="flex flex-wrap gap-2" role="tablist">
          {ORDER.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => choose(k)}
              className={`rounded-full border px-4 py-1.5 text-sm ${kind === k ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {kinds[k].title}
            </button>
          ))}
        </div>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm text-slate-600">{spec.description}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {spec.fields.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="text-slate-700">{f.label}</span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    min={f.type === "number" ? 0 : undefined}
                    max={f.max}
                    maxLength={f.type === "text" ? 60 : undefined}
                    value={inputs[f.key] ?? ""}
                    onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                    className={`rounded-md border border-slate-300 px-3 py-1.5 ${f.type === "number" ? "w-36 text-right tabular-nums" : "w-full"}`}
                  />
                  {f.unit && <span className="shrink-0 text-slate-500">{f.unit}</span>}
                </span>
              </label>
            ))}
            <label className="block text-sm">
              <span className="text-slate-700">施行日</span>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-1.5" />
            </label>
          </div>
          {ai && (
            <label className="block text-sm">
              <span className="text-slate-700">会社の事情(AIに伝えること・任意)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="例: 営業は外回りが多く、交通系ICカードで払うことが多い。領収書はスマホで撮って提出してほしい。"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => make(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "template" ? "作っています…" : "ひな形で作る"}
            </button>
            {ai && (
              <button onClick={() => make(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "ai" ? "AIが書いています…" : "AIで会社に合わせて作る"}
              </button>
            )}
          </div>
          {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
        </section>
      </div>

      {draft && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-sm text-slate-600">{draft.mode === "claude" ? "AIが会社に合わせて直した下書きです。" : "ひな形の下書きです。"}内容を確かめ、必要なら直してから印刷してください。</p>
            <div className="flex gap-2">
              <button onClick={() => setEditing((e) => !e)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                {editing ? "直し終わった" : "条文を直す"}
              </button>
              <PrintButton variant="outline" />
            </div>
          </div>

          {draft.checkpoints.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm print:hidden">
              <h2 className="font-semibold text-amber-900">導入の前に確かめること</h2>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-amber-900">
                {draft.checkpoints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}

          <article className="mx-auto max-w-3xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-7 shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
            <h1 className="text-center text-xl font-semibold tracking-widest">{draft.title}</h1>
            <p className="text-right">{draft.company || company}</p>
            {draft.articles.map((a, i) => {
              const supplement = a.title === "附則";
              const heading = supplement ? "附則" : `第${++n}条(${a.title})`;
              return (
                <section key={i}>
                  {editing && !supplement ? (
                    <label className="flex items-center gap-2 font-semibold">
                      <span className="shrink-0">第{n}条</span>
                      <input value={a.title} onChange={(e) => editArticle(i, { title: e.target.value })} className="w-full rounded-md border border-slate-300 px-2 py-1 font-normal" />
                    </label>
                  ) : (
                    <h2 className="font-semibold">{heading}</h2>
                  )}
                  {editing ? (
                    <textarea
                      value={a.paragraphs.join("\n")}
                      onChange={(e) => editArticle(i, { paragraphs: e.target.value.split("\n") })}
                      rows={Math.max(2, a.paragraphs.length + Math.ceil(a.paragraphs.join("").length / 40))}
                      className="mt-1 field-sizing-content w-full rounded-md border border-slate-300 px-2 py-1 leading-7"
                    />
                  ) : a.paragraphs.filter((p) => p.trim()).length > 1 ? (
                    a.paragraphs
                      .filter((p) => p.trim())
                      .map((p, j) => (
                        <p key={j}>
                          <span className="mr-1">{j + 1}</span>
                          {p}
                        </p>
                      ))
                  ) : (
                    <p>{a.paragraphs.join("")}</p>
                  )}
                </section>
              );
            })}
          </article>
        </div>
      )}
    </div>
  );
}
