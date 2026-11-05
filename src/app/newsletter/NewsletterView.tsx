"use client";

import Link from "next/link";
import { useState } from "react";

type Counts = { birthdays: number; anniversaries: number; joiners: number; events: number; closures: number };

export default function NewsletterView({ month: initialMonth }: { month: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [note, setNote] = useState("");
  const [birthdays, setBirthdays] = useState(true);
  const [useAi, setUseAi] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mailed: number } | null>(null);
  async function call(payload: unknown) {
    const res = await fetch("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "うまくいきませんでした");
    return json;
  }
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const draft = () =>
    run("draft", async () => {
      const r = await call({ action: "draft", month, note, birthdays, useAi });
      setTitle(r.title);
      setBody(r.body);
      setCounts(r.counts);
      setMode(r.mode);
      setDone(null);
    });
  const publish = () =>
    run("publish", async () => {
      if (!confirm("社内のお知らせに出しますか?")) return;
      const r = await call({ action: "publish", title, body, notify });
      setDone({ mailed: r.mailed });
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            月
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={birthdays} onChange={(e) => setBirthdays(e.target.checked)} />
            誕生日を入れる
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            AIで読みやすく整える
          </label>
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="総務からのひとこと(なくてもかまいません)。例: 年末の大掃除は12/26の午後です。" className="w-full rounded-md border border-slate-300 px-3 py-2" />
        <button onClick={draft} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          {busy === "draft" ? "作っています…" : "下書きを作る"}
        </button>
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
      </section>

      {counts && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
          <p className="text-xs text-slate-500">
            材料: 誕生日 {counts.birthdays}人・入社の記念日 {counts.anniversaries}人・新しく入った人 {counts.joiners}人・イベント {counts.events}件・お休み {counts.closures}件
            {mode === "claude" ? "(AIで整えました)" : useAi ? "(AIの文に材料にない名前や数字があったので、決まった文にしました)" : ""}
          </p>
          <input aria-label="件名" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 font-semibold" />
          <textarea aria-label="本文" value={body} onChange={(e) => setBody(e.target.value)} rows={16} className="w-full rounded-md border border-slate-300 px-3 py-2 leading-relaxed" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              メールでも知らせる
            </label>
            <button onClick={publish} disabled={!!busy || !title.trim() || !body.trim() || !!done} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "publish" ? "出しています…" : "社内のお知らせに出す"}
            </button>
            {done && (
              <span className="text-emerald-700">
                お知らせに出しました{done.mailed ? `(${done.mailed}人にメール)` : ""}。
                <Link href="/notices" className="underline">
                  社内のお知らせを見る
                </Link>
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
