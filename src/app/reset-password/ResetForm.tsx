"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

export function ResetForm({ token, name }: { token: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("passwordConfirm")) return setError("確認用のパスワードが一致しません");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "設定できませんでした");
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
        <p>新しいパスワードを設定しました。ほかの端末のログインはすべて解除しています。</p>
        <Link href="/login" className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          ログインする
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-600">{name} さんの新しいパスワードを入力してください(8文字以上)。</p>
      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <label className="block text-xs text-slate-500">
        新しいパスワード
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </label>
      <label className="block text-xs text-slate-500">
        新しいパスワード(確認)
        <input name="passwordConfirm" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </label>
      <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "設定中..." : "パスワードを設定する"}
      </button>
    </form>
  );
}
