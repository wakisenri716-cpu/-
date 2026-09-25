"use client";

import { useCallback, useEffect, useState } from "react";

type Settings = { email: string | null; dailyDigest: boolean; mode: "smtp" | "resend" | "test"; from: string | null; cron: boolean };
type Log = { id: string; kind: string; to: string; subject: string; body: string; status: string; error: string | null; sentByName: string; createdAt: string };

const MODE = {
  smtp: { label: "Gmail などのメールサーバーで送信中", className: "bg-emerald-50 text-emerald-900 ring-emerald-200" },
  resend: { label: "Resend で送信中", className: "bg-emerald-50 text-emerald-900 ring-emerald-200" },
  test: { label: "テストモード(まだ送信の設定がありません。送らずに履歴へ記録だけします)", className: "bg-amber-50 text-amber-900 ring-amber-200" },
} as const;

const KIND: Record<string, string> = { INVOICE: "請求書", QUOTE: "見積書", REMINDER: "督促", PASSWORD_RESET: "パスワード再設定", DIGEST: "やることのお知らせ", TEST: "テスト" };
const STATUS: Record<string, { label: string; className: string }> = {
  SENT: { label: "送信済み", className: "bg-emerald-100 text-emerald-800" },
  TEST: { label: "テスト(未送信)", className: "bg-slate-100 text-slate-600" },
  FAILED: { label: "失敗", className: "bg-rose-100 text-rose-800" },
};

const when = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function EmailSettings({ isAdmin, defaultTo }: { isAdmin: boolean; defaultTo: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [replyTo, setReplyTo] = useState("");
  const [digest, setDigest] = useState(false);
  const [testTo, setTestTo] = useState(defaultTo);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([fetch("/api/mail/settings"), fetch("/api/mail/logs")]);
    if (s.ok) {
      const body: Settings = await s.json();
      setSettings(body);
      setReplyTo(body.email ?? "");
      setDigest(body.dailyDigest);
    }
    setLogs(l.ok ? await l.json() : []);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body: unknown, ok: (json: Record<string, unknown>) => string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? { ok: true, text: ok(json) } : { ok: false, text: json.error || "処理に失敗しました" });
    load();
  }

  return (
    <div className="space-y-6">
      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      {settings && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className={`rounded-lg px-3 py-2 text-sm ring-1 ${MODE[settings.mode].className}`}>
            <span className="font-medium">送信の状態: </span>
            {MODE[settings.mode].label}
            {settings.from && settings.mode !== "test" && <span className="ml-1 text-xs">(送信元: {settings.from})</span>}
          </div>

          {settings.mode === "test" && (
            <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700" open={isAdmin}>
              <summary className="cursor-pointer font-medium">Gmail で送れるようにする手順(10分ほど)</summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
                <li>送信に使う Google アカウントで「2段階認証プロセス」をオンにします(Google アカウント → セキュリティ)。</li>
                <li>
                  Google アカウントの「アプリ パスワード」の画面(myaccount.google.com/apppasswords)で、名前に「経理AI」と入れて作成し、表示された16文字をメモします。
                </li>
                <li>
                  Vercel のプロジェクト(-saas-erp)→ Settings → Environment Variables に、次の4つを追加します。
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">
{`SMTP_HOST = smtp.gmail.com
SMTP_PORT = 465
SMTP_USER = (送信に使う Gmail アドレス)
SMTP_PASS = (2でメモした16文字。空白なし)`}
                  </pre>
                  毎朝の「やること」メールも使う場合は、<code className="rounded bg-slate-50 px-1">CRON_SECRET</code> に好きな長い文字列(20文字以上)も追加します。
                </li>
                <li>Vercel の Deployments から最新のものを「Redeploy」すると反映されます。この画面が「送信中」になったら、下の「テスト送信」で確かめてください。</li>
              </ol>
              <p className="mt-2 text-xs text-slate-500">Gmail から送れるのは1日500通ほどまでです。送信元は、そのGmailのアドレスになります(表示名は会社名)。</p>
            </details>
          )}

          {isAdmin ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                call("/api/mail/settings", "PUT", { email: replyTo.trim(), dailyDigest: digest }, () => "メールの設定を保存しました");
              }}
              className="space-y-3"
            >
              <label className="block text-sm text-slate-700">
                返信先のメールアドレス(お客さまが「返信」したときの宛先・本文の署名)
                <input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="info@example.co.jp" className="mt-1 w-full rounded-md border px-3 py-2 text-sm sm:w-96" />
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} className="mt-1" />
                <span>
                  毎朝8時ごろ、管理者に「やること」をメールで知らせる
                  <span className="block text-xs text-slate-500">
                    レビュー待ち・期限切れの請求書・精算待ちなどがあるときだけ送ります。{!settings.cron && "(Vercel に CRON_SECRET を設定すると動きます)"}
                  </span>
                </span>
              </label>
              <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                保存
              </button>
            </form>
          ) : (
            <p className="text-xs text-slate-500">メールの設定は管理者が変更できます。</p>
          )}

          {isAdmin && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                call("/api/mail/test", "POST", { to: testTo }, (j) => (j.status === "TEST" ? "テストモードのため送っていません(履歴に記録しました)" : `${j.to} にテストメールを送りました。届いているか確認してください`));
              }}
              className="flex flex-wrap items-end gap-2 border-t pt-4"
            >
              <label className="min-w-0 flex-1 text-xs text-slate-500 sm:flex-none">
                テスト送信の宛先
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2 text-sm text-slate-900 sm:w-80" />
              </label>
              <button type="submit" disabled={busy || !testTo} className="rounded-md border border-indigo-300 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                テスト送信
              </button>
            </form>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">送信履歴(新しい順・100件まで)</h2>
        {logs === null ? (
          <p className="px-4 py-6 text-sm text-slate-500">読み込み中...</p>
        ) : logs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">まだメールを送っていません。請求書・見積書の画面の「メールで送る」から送れます。</p>
        ) : (
          <ul className="divide-y text-sm">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-2">
                <button type="button" onClick={() => setOpen(open === l.id ? null : l.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
                  <span className="w-20 shrink-0 text-xs text-slate-500 tabular-nums">{when(l.createdAt)}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[l.status]?.className ?? ""}`}>{STATUS[l.status]?.label ?? l.status}</span>
                  <span className="shrink-0 text-xs text-slate-600">{KIND[l.kind] ?? l.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{l.subject}</span>
                  <span className="min-w-0 truncate text-xs text-slate-500">→ {l.to}</span>
                </button>
                {open === l.id && (
                  <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 text-xs">
                    <p className="text-slate-500">送信: {l.sentByName}</p>
                    {l.error && <p className="text-rose-700">エラー: {l.error}</p>}
                    <pre className="whitespace-pre-wrap break-words font-sans text-slate-700">{l.body}</pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
