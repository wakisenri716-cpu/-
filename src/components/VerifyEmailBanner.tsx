"use client";

import { useState } from "react";

// 新規登録したメールアドレスをまだ確かめていない人への案内
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | string>("idle");

  async function resend() {
    setState("busy");
    const res = await fetch("/api/auth/verify-email", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setState(res.ok ? "sent" : json.error || "送れませんでした");
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 print:hidden">
      <span>
        {email} に確認のメールを送りました。メールのリンクを開いて、メールアドレスの確認を済ませてください(有料プランの申し込みは確認のあとにできます)。
        {state === "sent" && <strong className="ml-1">もう一度送りました。</strong>}
        {state !== "idle" && state !== "busy" && state !== "sent" && <strong className="ml-1 text-rose-700">{state}</strong>}
      </span>
      <button onClick={resend} disabled={state === "busy" || state === "sent"} className="rounded-md border border-sky-300 bg-white px-3 py-1.5 font-medium whitespace-nowrap hover:bg-sky-100 disabled:opacity-50">
        確認のメールをもう一度送る
      </button>
    </div>
  );
}
