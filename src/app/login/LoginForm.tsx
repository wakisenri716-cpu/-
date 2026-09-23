"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Props = { mode: "login" | "setup" };

export function LoginForm(props: Props) {
  return (
    <Suspense>
      <LoginFormInner {...props} />
    </Suspense>
  );
}

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

function LoginFormInner({ mode }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = mode === "setup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (setup && data.password !== data.passwordConfirm) {
      setError("確認用のパスワードが一致しません");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
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
    <div className="mx-auto max-w-sm py-16">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">AI</span>
        <span className="font-semibold">経理オートメーション</span>
      </div>
      <h1 className="text-xl font-semibold">{setup ? "最初の管理者を作成" : "ログイン"}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {setup
          ? "まだ誰もパスワードを設定していません。あなたを管理者として登録します。ほかのメンバーは、ログイン後に「ユーザー管理」から追加できます。"
          : "メールアドレスとパスワードを入力してください。"}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {setup && (
          <div>
            <label className="block text-xs text-slate-500">名前</label>
            <input name="name" required autoComplete="name" className={inputClass} placeholder="山田 太郎" />
          </div>
        )}
        <div>
          <label className="block text-xs text-slate-500">メールアドレス</label>
          <input name="email" type="email" required autoComplete="email" className={inputClass} placeholder="you@example.com" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">パスワード{setup && "(8文字以上)"}</label>
          <input
            name="password"
            type="password"
            required
            minLength={setup ? 8 : undefined}
            autoComplete={setup ? "new-password" : "current-password"}
            className={inputClass}
          />
        </div>
        {setup && (
          <div>
            <label className="block text-xs text-slate-500">パスワード(確認)</label>
            <input name="passwordConfirm" type="password" required autoComplete="new-password" className={inputClass} />
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "処理中..." : setup ? "管理者を作成してはじめる" : "ログイン"}
        </button>
      </form>
    </div>
  );
}
