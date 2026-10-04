"use client";

import { useState, type FormEvent } from "react";

const CATEGORIES: [string, string][] = [
  ["USAGE", "使い方"],
  ["BILLING", "料金・契約"],
  ["BUG", "不具合・エラー"],
  ["ACCOUNT", "アカウント・ログイン"],
  ["DELETE", "アカウント・データの削除"],
  ["OTHER", "その他"],
];
const input = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

// お問い合わせフォーム(ログイン中なら名前とメールを入れておく)
export function SupportForm({ name = "", email = "" }: { name?: string; email?: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(json.error || "送れませんでした");
  }

  if (done) {
    return <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">お問い合わせを受け付けました。ご入力のメールアドレスに、通常3営業日以内にお返事します。</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-600">お名前</span>
          <input name="name" defaultValue={name} required maxLength={60} className={input} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">返信先のメールアドレス</span>
          <input name="email" type="email" defaultValue={email} required className={input} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="block text-sm">
          <span className="text-slate-600">種類</span>
          <select name="category" defaultValue="USAGE" className={input}>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">件名</span>
          <input name="subject" required maxLength={100} className={input} placeholder="例: 請求書の印刷について" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-slate-600">お問い合わせの内容</span>
        <textarea name="body" required minLength={10} maxLength={5000} rows={6} className={input} placeholder="どの画面で、何をしたら、どうなったかを書いていただくと早くお答えできます" />
      </label>
      {/* ロボットよけ(人には見えない欄) */}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <button disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "送信中..." : "送信する"}
      </button>
    </form>
  );
}
