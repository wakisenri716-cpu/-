"use client";

import { useCallback, useEffect, useState } from "react";

type Session = { id: string; device: string; createdAt: string; lastSeenAt: string | null; current: boolean };

const TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function SessionsSection() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/sessions");
    setSessions(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function remove(url: string, done: (body: { count?: number }) => string) {
    setBusy(true);
    const res = await fetch(url, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? done(body) : body.error || "処理に失敗しました");
    await load();
  }

  const others = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">ログイン中の端末</h2>
      <p className="text-sm text-slate-600">覚えのない端末があれば、ログアウトさせてからパスワードを変更してください。</p>
      {message && <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</div>}
      <ul className="divide-y">
        {(sessions ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <div className="font-medium">
                {s.device}
                {s.current && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">この端末</span>}
              </div>
              <div className="text-xs text-slate-500">
                ログイン {TIME.format(new Date(s.createdAt))}
                {s.lastSeenAt && ` ・ 最終利用 ${TIME.format(new Date(s.lastSeenAt))}`}
              </div>
            </div>
            {!s.current && (
              <button onClick={() => remove(`/api/auth/sessions/${s.id}`, () => "ログアウトさせました")} disabled={busy} className="shrink-0 text-xs whitespace-nowrap text-rose-600 hover:underline">
                ログアウト
              </button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <button
          onClick={() => remove("/api/auth/sessions", (b) => `${b.count ?? 0}台の端末をログアウトさせました`)}
          disabled={busy}
          className="rounded-md border border-rose-200 px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          この端末以外をすべてログアウト
        </button>
      )}
    </section>
  );
}
