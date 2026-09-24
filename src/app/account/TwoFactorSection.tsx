"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Status = { enabled: boolean; recoveryCodesRemaining: number };

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

export function TwoFactorSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/totp");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(path: string, body?: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/auth/totp/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "処理に失敗しました");
      return null;
    }
    return data;
  }

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const data = await post("enable", { code });
    if (data) {
      setSetup(null);
      setRecoveryCodes(data.recoveryCodes);
      await load();
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (await post("disable", { password })) {
      setRecoveryCodes(null);
      await load();
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">2段階認証</h2>
        {status && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
            {status.enabled ? "有効" : "無効"}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600">
        ログインのときに、パスワードに加えてスマホの認証アプリ(Google Authenticator、Microsoft Authenticator など)に表示される6桁のコードを入力します。パスワードが漏れても、スマホがなければログインできなくなります。
      </p>
      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {recoveryCodes && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">回復コード(この画面でしか表示されません)</p>
          <p className="text-xs text-amber-900">スマホをなくしたときに、6桁コードの代わりに1回ずつ使えます。紙に書くなどして、安全な場所に保管してください。</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button onClick={() => setRecoveryCodes(null)} className="text-xs text-amber-900 underline">
            保管しました
          </button>
        </div>
      )}

      {status && !status.enabled && !setup && (
        <button
          onClick={async () => {
            const data = await post("setup");
            if (data) setSetup(data);
          }}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          設定を始める
        </button>
      )}

      {setup && (
        <form onSubmit={enable} className="space-y-3">
          <p className="text-sm text-slate-700">1. 認証アプリでこのQRコードを読み取ってください。</p>
          {/* QRコードはサーバーで qrcode ライブラリが作ったSVG(利用者の入力を含まない) */}
          <div className="h-44 w-44 rounded-lg border bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <p className="text-xs text-slate-500">
            読み取れない場合は、アプリで「セットアップキーを入力」を選び、次のキーを入力してください:
            <span className="mt-1 block font-mono text-sm tracking-wider break-all text-slate-800">{setup.secret}</span>
          </p>
          <label className="block text-sm text-slate-700">
            2. アプリに表示された6桁のコード
            <input name="code" required inputMode="numeric" autoComplete="one-time-code" className={`${inputClass} tracking-widest`} placeholder="123456" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
              有効にする
            </button>
            <button type="button" onClick={() => setSetup(null)} className="rounded-md border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              やめる
            </button>
          </div>
        </form>
      )}

      {status?.enabled && (
        <form onSubmit={disable} className="space-y-3 border-t pt-3">
          <p className="text-xs text-slate-500">回復コードの残り: {status.recoveryCodesRemaining}個</p>
          <label className="block text-xs text-slate-500">
            無効にするには、パスワードを入力してください
            <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
          </label>
          <button type="submit" disabled={busy} className="rounded-md border border-rose-200 px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            2段階認証を無効にする
          </button>
        </form>
      )}
    </section>
  );
}
