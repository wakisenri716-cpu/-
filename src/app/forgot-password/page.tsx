"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

// パスワードを忘れたとき: メールアドレスを入れると、再設定のリンクをメールで送る
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const email = new FormData(event.currentTarget).get("email");
    await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-xl font-semibold">パスワードの再設定</h1>
      {sent ? (
        <div className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
          <p>入力したメールアドレスが登録されていれば、パスワード再設定のリンクを送りました。メールを確認してください(リンクは1時間有効です)。</p>
          <p className="text-xs text-slate-500">
            メールが届かないときは、迷惑メールのフォルダも確認してください。会社でメール送信を設定していない場合は届きません。そのときは管理者にパスワードの再設定を頼んでください。
          </p>
          <Link href="/login" className="inline-block text-indigo-700 hover:underline">
            ログイン画面に戻る
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-600">登録しているメールアドレスを入力してください。パスワードを決め直すためのリンクをお送りします。</p>
          <label className="block text-xs text-slate-500">
            メールアドレス
            <input name="email" type="email" required autoComplete="email" className={inputClass} placeholder="you@example.com" />
          </label>
          <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "送信中..." : "再設定のメールを送る"}
          </button>
          <Link href="/login" className="block text-center text-xs text-slate-500 hover:underline">
            ログイン画面に戻る
          </Link>
        </form>
      )}
    </div>
  );
}
