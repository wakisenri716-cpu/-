"use client";

import { useState, type FormEvent } from "react";

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

export default function AccountPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.newPassword !== data.newPasswordConfirm) {
      setError("確認用のパスワードが一致しません");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "変更に失敗しました");
      form.reset();
      setMessage("パスワードを変更しました。ほかの端末でのログインは解除されました。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">アカウント</h1>
        <p className="mt-1 text-sm text-slate-600">ログインパスワードを変更できます。</p>
      </div>
      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <label className="block text-xs text-slate-500">今のパスワード</label>
          <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-slate-500">新しいパスワード(8文字以上)</label>
          <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-slate-500">新しいパスワード(確認)</label>
          <input name="newPasswordConfirm" type="password" required autoComplete="new-password" className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "変更中..." : "パスワードを変更"}
        </button>
      </form>
    </div>
  );
}
