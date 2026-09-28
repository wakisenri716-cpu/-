"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CompanyFields, TermsAgreement, type CompanyDefaults } from "@/components/CompanyFields";

export function WelcomeForm({
  userName,
  needsTerms,
  needsCompanyInfo,
  termsUpdated,
  defaults,
}: {
  userName: string;
  needsTerms: boolean;
  needsCompanyInfo: boolean;
  termsUpdated: boolean;
  defaults: CompanyDefaults;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/welcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(json.error || "保存できませんでした");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push("/");
    router.refresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(Object.fromEntries(new FormData(event.currentTarget)));
  }

  function skip(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const agree = form?.querySelector<HTMLInputElement>("input[name=agree]");
    if (agree && !agree.checked) {
      setError("利用規約とプライバシーポリシーに同意してください");
      return;
    }
    send({ skipCompany: true, agree: agree?.checked ?? false });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold">ようこそ、{userName}さん</h1>
        <p className="mt-1 text-sm text-slate-600">
          {needsCompanyInfo ? "はじめる前に、会社の情報をまとめて入力してください。請求書・見積書・給与明細などの書類に使います。" : ""}
          {needsTerms && (termsUpdated ? "利用規約・プライバシーポリシーを改定しました。内容を確かめて同意してください。" : "ご利用の前に、利用規約とプライバシーポリシーをお読みください。")}
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <form onSubmit={submit} className="space-y-6">
        {needsCompanyInfo && (
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">会社の情報</h2>
            <CompanyFields defaults={defaults} />
          </section>
        )}
        {needsTerms && <TermsAgreement />}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? "保存中..." : needsCompanyInfo ? "保存してはじめる" : "同意してはじめる"}
          </button>
          {needsCompanyInfo && (
            <button type="button" onClick={skip} disabled={submitting} formNoValidate className="text-sm text-slate-500 hover:underline">
              会社の情報はあとで入力する
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
