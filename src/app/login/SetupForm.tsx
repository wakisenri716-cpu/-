"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CompanyFields, TermsAgreement } from "@/components/CompanyFields";
import { LegalLinks } from "@/components/LegalLinks";

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

// 新規登録: 管理者のアカウントと、会社の情報・規約への同意をまとめて受け付ける
// (最初の1社は /api/auth/setup、サービスとして公開してからの会社は /api/auth/signup)
export function SetupForm({ endpoint = "/api/auth/setup", trialDays }: { endpoint?: string; trialDays?: number }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.password !== data.passwordConfirm) {
      setError("確認用のパスワードが一致しません");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "登録できませんでした");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">AI</span>
        <span className="font-semibold">経理オートメーション</span>
      </div>
      <h1 className="text-xl font-semibold">新規登録{trialDays ? `(${trialDays}日間無料)` : ""}</h1>
      {trialDays && (
        <p className="mt-1 text-sm text-indigo-700">
          カードの登録なしで、{trialDays}日間すべての機能を無料で使えます。続けて使うときだけ、管理者が有料プランに申し込みます。
          <a href="/pricing" className="ml-1 underline">
            料金プラン
          </a>
        </p>
      )}
      <p className="mt-1 text-sm text-slate-600">
        あなたのアカウント(管理者)と会社の情報を、この1ページで登録します。会社の情報はあとから「会社情報」で直せます。ほかのメンバーは、登録後に「ユーザー管理」から追加できます。
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">1. あなたのアカウント(管理者)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">
                お名前 <span className="text-rose-600">*</span>
              </span>
              <input name="name" required maxLength={60} autoComplete="name" className={inputClass} placeholder="山田 太郎" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                メールアドレス <span className="text-rose-600">*</span>
              </span>
              <input name="email" type="email" required autoComplete="email" className={inputClass} placeholder="you@example.com" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                パスワード(8文字以上) <span className="text-rose-600">*</span>
              </span>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                パスワード(確認) <span className="text-rose-600">*</span>
              </span>
              <input name="passwordConfirm" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">2. 会社の情報</h2>
          <CompanyFields />
        </section>

        <section className="space-y-3">
          <TermsAgreement />
          <button type="submit" disabled={submitting} className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? "登録中..." : "登録してはじめる"}
          </button>
        </section>
      </form>
      <LegalLinks />
    </div>
  );
}
