"use client";

import { useState } from "react";
import type { Prep } from "@/lib/meetingPrep";
import { PrintButton } from "@/components/PrintButton";

export default function PrepView({ kind, id, initial, ai, today }: { kind: string; id: string; initial: Prep; ai: boolean; today: string }) {
  const [prep, setPrep] = useState(initial);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState<"template" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      const res = await fetch(`/api/parties/${kind}/${id}/prep`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose, useAi }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setPrep(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const c = prep.contact;
  const section = "space-y-1";
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <label className="block min-w-[16rem] flex-1 text-sm">
          <span className="text-slate-700">今回の目的(任意)</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 来期の発注量の相談と、新サービスのご紹介" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" />
        </label>
        <button onClick={() => make(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {busy === "template" ? "作っています…" : "作り直す"}
        </button>
        {ai && (
          <button onClick={() => make(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy === "ai" ? "AIが整えています…" : "AIで整える"}
          </button>
        )}
        <PrintButton variant="outline" />
        <a href={`/vendors/${kind}/${id}/after`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          訪問のあとで
        </a>
        {error && <p className="w-full rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      <article className="mx-auto max-w-[210mm] space-y-5 rounded-xl bg-white p-6 text-sm leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-8 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-3">
          <h2 className="text-xl font-semibold">{prep.party} 訪問・打ち合わせの準備</h2>
          <span className="text-xs text-slate-500">
            {today}作成{prep.mode === "claude" ? "・AIで整えました" : ""}
          </span>
        </header>
        <div className="grid gap-x-6 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
          <p>担当: {[c.department, c.contactName ? `${c.contactName} 様` : null].filter(Boolean).join(" ") || "(未登録)"}</p>
          <p>電話: {c.phone ?? "(未登録)"}</p>
          {c.email !== null && <p>メール: {c.email}</p>}
          <p className="sm:col-span-2">住所: {c.address ?? "(未登録)"}</p>
        </div>
        <section className={section}>
          <h3 className="font-semibold">相手のいま</h3>
          {prep.situation.map((s) => (
            <p key={s}>・{s}</p>
          ))}
          {prep.cautions.map((s) => (
            <p key={s} className="text-rose-700">
              ⚠ {s}
            </p>
          ))}
        </section>
        <section className={section}>
          <h3 className="font-semibold">話すこと</h3>
          <ol className="space-y-2">
            {prep.agenda.map((a, i) => (
              <li key={i}>
                <p className="font-medium">
                  {i + 1}. {a.topic}
                </p>
                {a.points.map((p) => (
                  <p key={p} className="pl-4 text-slate-700">
                    - {p}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </section>
        {prep.confirm.length > 0 && (
          <section className={section}>
            <h3 className="font-semibold">確かめること</h3>
            {prep.confirm.map((s) => (
              <p key={s}>□ {s}</p>
            ))}
          </section>
        )}
        <section className={section}>
          <h3 className="font-semibold">持っていくもの</h3>
          <p>{prep.bring.map((b) => `□ ${b}`).join("  ")}</p>
        </section>
        {prep.notes.length > 0 && (
          <section className={section}>
            <h3 className="font-semibold">最近のメモ</h3>
            {prep.notes.map((n) => (
              <p key={n} className="text-slate-700">
                ・{n}
              </p>
            ))}
          </section>
        )}
        <section className="space-y-1 border-t border-dashed border-slate-300 pt-3">
          <h3 className="font-semibold">当日のメモ</h3>
          <div className="h-32" />
        </section>
      </article>
    </div>
  );
}
