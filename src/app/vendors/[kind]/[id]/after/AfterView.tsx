"use client";

import { useState } from "react";
import Link from "next/link";
import type { VisitFollow } from "@/lib/visitFollowup";

export default function AfterView({ kind, id, ai, today }: { kind: string; id: string; ai: boolean; today: string }) {
  const [notes, setNotes] = useState("");
  const [visitedOn, setVisitedOn] = useState(today);
  const [result, setResult] = useState<VisitFollow | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "template");
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/parties/${kind}/${id}/after`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes, visitedOn, useAi }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setResult(data);
      setSubject(data.thanks.subject);
      setBody(data.thanks.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!result) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/parties/${kind}/${id}/after`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ visitedOn, summary: result.summary, todos: result.todos }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "残せませんでした");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "残せませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`件名: ${subject}\n\n${body}`);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください");
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label className="block max-w-xs text-sm">
          <span className="text-slate-700">訪問・打ち合わせの日</span>
          <input type="date" value={visitedOn} onChange={(e) => setVisitedOn(e.target.value)} className={input} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">メモ</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8} placeholder={"来期は発注量を2割増やしたい\n新しい担当は鈴木さん\n見積を10/20までに送る 担当:田中\n先方が社内で予算を確認する"} className={input} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => make(false)} disabled={!!busy || !notes.trim()} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "template" ? "まとめています…" : "まとめる"}
          </button>
          {ai && (
            <button onClick={() => make(true)} disabled={!!busy || !notes.trim()} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIが整えています…" : "AIで整える"}
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      </section>

      {result && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">まとめ・やること</h2>
              <span className="text-xs text-slate-500">{result.mode === "claude" ? "AIが整えました" : "メモから分けました"}</span>
            </div>
            {result.summary.length > 0 && (
              <ul className="space-y-1">
                {result.summary.map((s) => (
                  <li key={s}>・{s}</li>
                ))}
              </ul>
            )}
            <div>
              <p className="text-xs font-medium text-slate-600">やること</p>
              {result.todos.length ? (
                <ul className="mt-1 space-y-1">
                  {result.todos.map((t, i) => (
                    <li key={i}>
                      □ {t.task}
                      <span className="ml-1 text-xs text-slate-500">
                        {t.owner ? `担当 ${t.owner}` : ""}
                        {t.due ? ` ・ ${t.due}まで` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-500">見つかりませんでした(「〜までに」「送る」「確認する」などを書くと拾います)</p>
              )}
            </div>
            {saved ? (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
                取引先カルテのメモに残しました。
                <Link href={`/vendors/${kind}/${id}`} className="ml-1 underline">
                  カルテを見る
                </Link>
              </p>
            ) : (
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "save" ? "残しています…" : "カルテのメモに残す"}
              </button>
            )}
          </section>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
            <h2 className="font-semibold">お礼メールの下書き</h2>
            <label className="block">
              <span className="text-slate-700">件名</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
            </label>
            <label className="block">
              <span className="text-slate-700">本文</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className={input} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                {copied ? "コピーしました" : "件名と本文をコピー"}
              </button>
              <a href={`mailto:${encodeURIComponent(result.thanks.to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                メールソフトで開く
              </a>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
