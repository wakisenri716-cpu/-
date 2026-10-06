"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProcedureCase, ProcedureTask } from "@/lib/hrProcedures";

type Data = { today: string; cases: ProcedureCase[]; findings: string[] };
type Guide = { subject: string; body: string; mode: "claude" | "template" };

const STATUS: Record<ProcedureTask["status"], { label: string; cls: string } | null> = {
  done: { label: "済み", cls: "bg-emerald-100 text-emerald-800" },
  overdue: { label: "期限切れ", cls: "bg-rose-100 text-rose-800" },
  soon: { label: "1週間以内", cls: "bg-amber-100 text-amber-800" },
  later: null,
  none: null,
};
const md = (key: string) => key.slice(5).replace("-", "/").replace(/^0/, "").replace("/0", "/");
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export default function HrProceduresView({ initial, ai }: { initial: Data; ai: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(staffId: string, key: string, done: boolean) {
    setBusy(`${staffId}:${key}`);
    setError(null);
    try {
      const res = await fetch("/api/hr-procedures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ staffId, key, done }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {data.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {data.cases.length === 0 && (
        <p className="text-sm">
          <Link href="/staff-records" className="text-indigo-700 hover:underline">
            労働者名簿で入社日・退職日を入れる →
          </Link>
        </p>
      )}
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}

      {data.cases.map((c) => {
        const d = days(data.today, c.date);
        return (
          <section key={`${c.staffId}-${c.kind}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.kind === "hire" ? "bg-indigo-100 text-indigo-800" : "bg-slate-200 text-slate-700"}`}>{c.kind === "hire" ? "入社" : "退職"}</span>
              <h2 className="font-semibold">{c.name}さん</h2>
              <span className="text-sm text-slate-600">
                {c.kind === "hire" ? "入社日" : "退職日"} {c.date.replaceAll("-", "/")}({d > 0 ? `あと${d}日` : d === 0 ? "今日" : `${-d}日前`})
              </span>
              <span className="ml-auto text-sm text-slate-600">{c.remaining ? `残り${c.remaining}件` : "すべて済み"}</span>
            </div>
            <ul className="divide-y">
              {c.tasks.map((t) => {
                const chip = STATUS[t.status];
                const id = `${c.staffId}:${t.key}`;
                return (
                  <li key={t.key} className="flex gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={t.done}
                      disabled={t.auto || busy === id}
                      onChange={(e) => toggle(c.staffId, t.key, e.target.checked)}
                      aria-label={`${t.label}を済みにする`}
                      title={t.auto ? "データから自動で判定します" : undefined}
                      className="mt-1 h-4 w-4 shrink-0 accent-indigo-700"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`text-sm font-medium ${t.done ? "text-slate-500 line-through decoration-slate-400" : ""}`}>{t.label}</span>
                        {chip && <span className={`rounded-full px-2 py-0.5 text-xs ${chip.cls}`}>{chip.label}</span>}
                        {t.auto && <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500">自動</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {t.dueNote}
                        {t.due && `(${md(t.due)}まで)`}
                        {t.doneBy && ` ・ ${t.doneBy}さんが済みに`}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">{t.detail}</p>
                    </div>
                    {t.link && (
                      <Link href={t.link} className="shrink-0 self-start text-sm whitespace-nowrap text-indigo-700 hover:underline">
                        開く →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <GuidePanel staffId={c.staffId} kind={c.kind} ai={ai} />
          </section>
        );
      })}
    </div>
  );
}

function GuidePanel({ staffId, kind, ai }: { staffId: string; kind: ProcedureCase["kind"]; ai: boolean }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState<"template" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    try {
      const res = await fetch("/api/hr-procedures/guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ staffId, notes, useAi }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setGuide(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!guide) return;
    await navigator.clipboard.writeText(`${guide.subject}\n\n${guide.body}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!open)
    return (
      <div className="border-t bg-slate-50 px-4 py-2">
        <button onClick={() => setOpen(true)} className="text-sm font-medium text-indigo-700 hover:underline">
          本人に送る{kind === "hire" ? "入社" : "退職"}の案内を作る
        </button>
      </div>
    );
  return (
    <div className="space-y-3 border-t bg-slate-50 px-4 py-3">
      {ai && (
        <label className="block text-sm">
          <span className="text-slate-700">AIに伝えること(任意)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder={kind === "hire" ? "例: 初日は9時に本社の受付へ。服装は自由。" : "例: 5年間ありがとう。最終日は送別会があります。"}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => make(false)} disabled={!!busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {busy === "template" ? "作っています…" : "ひな形で作る"}
        </button>
        {ai && (
          <button onClick={() => make(true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy === "ai" ? "AIが書いています…" : "AIで書く"}
          </button>
        )}
      </div>
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {guide && (
        <div className="space-y-2">
          <input value={guide.subject} onChange={(e) => setGuide({ ...guide, subject: e.target.value })} aria-label="件名" className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium" />
          <textarea value={guide.body} onChange={(e) => setGuide({ ...guide, body: e.target.value })} aria-label="本文" rows={14} className="field-sizing-content w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6" />
          <div className="flex items-center gap-3">
            <button onClick={copy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              {copied ? "コピーしました" : "件名と本文をコピー"}
            </button>
            <span className="text-xs text-slate-500">{guide.mode === "claude" ? "AIが書いた下書きです。" : "ひな形の下書きです。"}送る前に内容を確かめてください。</span>
          </div>
        </div>
      )}
    </div>
  );
}
