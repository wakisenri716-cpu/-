"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

const DAY = 86_400_000;
const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const md = (key: string) =>
  `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

// 「## 見出し」と「・」の行を読みやすく出す
function Preview({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) =>
        line.startsWith("## ") ? (
          <h3 key={i} className="pt-3 text-base font-semibold first:pt-0">
            {line.slice(3)}
          </h3>
        ) : line.trim() ? (
          <p key={i} className={line.startsWith("・") ? "pl-4 -indent-4" : ""}>
            {line}
          </p>
        ) : (
          <Fragment key={i} />
        ),
      )}
    </div>
  );
}

export default function WeeklyView({
  initialWeek,
  thisWeek,
  ai,
  canPost,
}: {
  initialWeek: string;
  thisWeek: string;
  ai: boolean;
  canPost: boolean;
}) {
  const [week, setWeek] = useState(initialWeek);
  const [body, setBody] = useState<string | null>(null);
  const [mode, setMode] = useState<"claude" | "template" | null>(null);
  const [editing, setEditing] = useState(false);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function call(url: string, payload: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }

  async function make(useAi: boolean) {
    setBusy(useAi ? "ai" : "make");
    setError(null);
    setFlash(null);
    try {
      const data = await call("/api/reports/weekly", { week, useAi });
      setBody(data.body);
      setMode(data.mode);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function post() {
    if (!body) return;
    setBusy("post");
    setError(null);
    try {
      const data = await call("/api/reports/weekly/announce", {
        week,
        body,
        notify,
      });
      setFlash(
        `社内のお知らせに載せました${data.mailed ? `(${data.mailed}人にメールしました)` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body.replace(/^## /gm, "■ "));
      setFlash("コピーしました");
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください");
    }
  }

  function move(n: number) {
    setWeek((w) => addDays(w, n * 7));
    setBody(null);
    setMode(null);
    setFlash(null);
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 print:hidden">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={() => move(-1)}
            className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50"
            aria-label="前の週"
          >
            ◀
          </button>
          <span className="font-medium tabular-nums">
            {md(week)}(月)〜{md(addDays(week, 6))}(日)
          </span>
          {week < thisWeek && (
            <button
              onClick={() => move(1)}
              className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50"
              aria-label="次の週"
            >
              ▶
            </button>
          )}
          {week === thisWeek && (
            <span className="text-xs text-slate-500">(今週・途中まで)</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => make(false)}
            disabled={!!busy}
            className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
          >
            {busy === "make" ? "まとめています…" : "週報を作る"}
          </button>
          {ai && (
            <button
              onClick={() => make(true)}
              disabled={!!busy}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {busy === "ai" ? "AIが書いています…" : "AIで書く"}
            </button>
          )}
        </div>
        {error && (
          <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}
      </section>

      {body !== null && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 print:border-0 print:p-0 print:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-xs text-slate-500">
              {mode === "claude"
                ? "AIが「ひとこと」と「来週の重点」を書きました。"
                : "決まったルールでまとめました。"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setEditing((v) => !v)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                {editing ? "見た目で確かめる" : "本文を直す"}
              </button>
              <button
                onClick={copy}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                コピー
              </button>
              <button
                onClick={() => window.print()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                印刷
              </button>
            </div>
          </div>
          <h2 className="hidden text-lg font-semibold print:block">
            週報({md(week)}〜{md(addDays(week, 6))})
          </h2>
          {editing ? (
            <textarea
              aria-label="週報の本文"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={20}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          ) : (
            <Preview text={body} />
          )}
          {canPost && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 print:hidden">
              <button
                onClick={post}
                disabled={!!busy || !body.trim()}
                className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50"
              >
                {busy === "post" ? "載せています…" : "社内のお知らせに載せる"}
              </button>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                />
                メールでも知らせる
              </label>
            </div>
          )}
          {flash && (
            <p className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 print:hidden">
              {flash}
              {flash.startsWith("社内のお知らせ") && (
                <Link href="/notices" className="ml-2 underline">
                  お知らせを見る
                </Link>
              )}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
