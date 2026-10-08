"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KarteEvent } from "@/lib/partyKarte";

type Summary = { status: string[]; cautions: string[]; next: string[]; summary: string | null; mode: "claude" | "template" };

const TYPE_STYLE: Record<string, string> = {
  請求: "bg-indigo-50 text-indigo-800",
  入金: "bg-emerald-50 text-emerald-800",
  支払: "bg-emerald-50 text-emerald-800",
  見積: "bg-sky-50 text-sky-800",
  発注: "bg-sky-50 text-sky-800",
  電話: "bg-amber-50 text-amber-900",
  来客: "bg-amber-50 text-amber-900",
  メモ: "bg-vermilion-50 text-vermilion-800",
  商談: "bg-violet-50 text-violet-800",
  契約: "bg-slate-100 text-slate-700",
  メール: "bg-slate-100 text-slate-700",
};

export function PartyKarte({ kind, id, events, initialSummary, ai }: { kind: "customer" | "vendor"; id: string; events: KarteEvent[]; initialSummary: Summary; ai: boolean }) {
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("すべて");

  async function call(url: string, init: RequestInit) {
    const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }

  async function summarize() {
    setBusy("ai");
    setError(null);
    try {
      setSummary(await call(`/api/parties/${kind}/${id}/summary`, { method: "POST", body: JSON.stringify({ useAi: true }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function addNote() {
    setBusy("note");
    setError(null);
    try {
      await call(`/api/parties/${kind}/${id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) });
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function removeNote(noteId: string) {
    if (!window.confirm("このメモを消しますか?")) return;
    setBusy(noteId);
    try {
      await call(`/api/parties/${kind}/${id}/notes?noteId=${encodeURIComponent(noteId)}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  const types = ["すべて", ...Array.from(new Set(events.map((e) => e.type)))];
  const shown = filter === "すべて" ? events : events.filter((e) => e.type === filter);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">この相手のいま</h2>
          <Link href={`/vendors/${kind}/${id}/prep`} className="ml-auto text-xs text-indigo-700 underline">
            訪問・打ち合わせの準備
          </Link>
          {ai && (
            <button onClick={summarize} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIがまとめています…" : summary.mode === "claude" ? "AIでまとめ直す" : "AIでまとめる"}
            </button>
          )}
        </div>
        {summary.summary && <p className="rounded-md bg-indigo-50/60 px-3 py-2 text-sm leading-relaxed text-slate-800">{summary.summary}</p>}
        <ul className="space-y-1 text-sm text-slate-700">
          {summary.status.map((s) => (
            <li key={s}>・{s}</li>
          ))}
        </ul>
        {summary.cautions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-rose-700">気をつけること</p>
            <ul className="mt-1 space-y-1 text-sm text-rose-800">
              {summary.cautions.map((s) => (
                <li key={s}>・{s}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-slate-600">次にやること</p>
          {summary.next.length ? (
            <ul className="mt-1 space-y-1 text-sm text-slate-800">
              {summary.next.map((s) => (
                <li key={s}>□ {s}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-500">いまは特にありません。</p>
          )}
        </div>
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <label className="block text-sm">
            <span className="text-slate-700">メモを残す(打ち合わせ・電話・訪問で話したこと)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="例: 来期から発注量を2割増やしたいとのこと。年明けに見積を出す" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" />
          </label>
          <button onClick={addNote} disabled={!!busy || !note.trim()} className="rounded-md bg-vermilion-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "note" ? "残しています…" : "メモを残す"}
          </button>
        </div>
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">やりとりの記録</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="記録の種類" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">まだ記録はありません。</p>
        ) : (
          <ol className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {shown.map((e, n) => (
              <li key={`${e.at}-${n}`} className="flex gap-3 text-sm">
                <span className="w-20 shrink-0 pt-0.5 text-xs text-slate-500 tabular-nums">{e.at}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_STYLE[e.type] ?? "bg-slate-100 text-slate-700"}`}>{e.type}</span>
                    {e.href ? (
                      <Link href={e.href} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                        {e.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-800">{e.title}</span>
                    )}
                    {e.noteId && (
                      <button onClick={() => removeNote(e.noteId!)} disabled={busy === e.noteId} className="text-xs text-slate-400 hover:text-rose-700">
                        消す
                      </button>
                    )}
                  </div>
                  {e.detail && <p className="mt-0.5 break-words whitespace-pre-wrap text-xs text-slate-600">{e.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
