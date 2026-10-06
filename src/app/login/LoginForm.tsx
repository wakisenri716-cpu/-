"use client";

import { ClerklyLogo } from "@/components/Logo";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LegalLinks } from "@/components/LegalLinks";

export function LoginForm({ signupOpen = false }: { signupOpen?: boolean }) {
  return (
    <Suspense>
      <LoginFormInner signupOpen={signupOpen} />
    </Suspense>
  );
}

const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm";

function LoginFormInner({ signupOpen }: { signupOpen: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2段階認証が有効な人は、パスワードの確認後に6桁コードを入力する(メール・パスワードは覚えておいて一緒に送る)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const data = credentials ? { ...credentials, code: form.code } : form;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (body.totpRequired && !credentials) {
        setCredentials({ email: String(data.email), password: String(data.password) });
        return;
      }
      if (!res.ok) throw new Error(body.error || "ログインに失敗しました");
      const next = searchParams.get("next");
      // 外部サイトへ飛ばされないよう、同じサイト内のパス("/"始まり、"//" や "/\" でない)だけを許可する
      router.push(next && /^\/(?![/\\])/.test(next) ? next : "/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm py-12 lg:py-0">
      <div className="mb-8">
        <ClerklyLogo size={30} />
      </div>
      <h1 className="text-2xl font-bold">ログイン</h1>
      <p className="mt-1 text-sm text-slate-600">メールアドレスとパスワードを入力してください。</p>

      {credentials ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <p className="text-sm text-slate-700">2段階認証が有効です。認証アプリに表示されている6桁のコードを入力してください。</p>
          <div>
            <label className="block text-xs text-slate-500">確認コード</label>
            <input name="code" required autoFocus autoComplete="one-time-code" inputMode="numeric" className={`${inputClass} tracking-widest`} placeholder="123456" />
            <p className="mt-1 text-xs text-slate-500">スマホをなくしたときは、回復コード(例: abcd-efgh)も使えます。</p>
          </div>
          <button type="submit" disabled={submitting} className="w-full rounded-lg bg-vermilion-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
            {submitting ? "確認中..." : "ログイン"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCredentials(null);
              setError(null);
            }}
            className="w-full text-xs text-slate-500 hover:underline"
          >
            メールアドレスの入力に戻る
          </button>
        </form>
      ) : (
      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div>
          <label className="block text-xs text-slate-500">メールアドレス</label>
          <input name="email" type="email" required autoComplete="email" className={inputClass} placeholder="you@example.com" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">パスワード</label>
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-vermilion-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50"
        >
          {submitting ? "処理中..." : "ログイン"}
        </button>
        <a href="/forgot-password" className="block text-center text-xs text-indigo-700 hover:underline">
          パスワードを忘れた方
        </a>
      </form>
      )}
      {signupOpen ? (
        <p className="mt-4 text-center text-sm text-slate-600">
          はじめての方は
          <a href="/signup" className="mx-1 font-medium text-indigo-700 hover:underline">
            新規登録(無料でお試し)
          </a>
        </p>
      ) : null}
      <p className="mt-2 text-center text-xs text-slate-500">会社のメンバーのアカウントは、会社の管理者が「ユーザー管理」から作ります。</p>
      <LegalLinks />
    </div>
  );
}
