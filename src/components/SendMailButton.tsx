"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Kind = "invoice" | "quote" | "reminder";
const LABEL: Record<Kind, string> = { invoice: "請求書をメールで送る", quote: "見積書をメールで送る", reminder: "督促メールを送る" };

// 書類をメールで送るボタン。押すと宛先・件名・本文(共有リンク入り)を入れた送信欄が開き、確認・修正してから送る。
export function SendMailButton({ kind, id, tone = "default" }: { kind: Kind; id: string; tone?: "default" | "warning" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string; mode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function start() {
    setOpen(true);
    setMessage(null);
    const res = await fetch(`/api/mail/draft?kind=${kind}&id=${encodeURIComponent(id)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ ok: false, text: body.error || "送信の準備ができませんでした" });
      return;
    }
    setDraft(body);
  }

  async function send() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, to: draft.to, subject: draft.subject, body: draft.body }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: body.error || "送信できませんでした" });
    setMessage({ ok: true, text: body.status === "TEST" ? `テストモードのため実際には送っていません(送信履歴に記録しました)。宛先: ${body.to}` : `${body.to} に送信しました` });
    setOpen(false);
    router.refresh();
  }

  const button =
    tone === "warning"
      ? "rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
      : "rounded-md border border-indigo-300 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50";

  return (
    <>
      <button type="button" onClick={start} className={`${button} print:hidden`}>
        {LABEL[kind]}
      </button>
      {message && !open && (
        <span className={`basis-full text-right text-xs ${message.ok ? "text-emerald-700" : "text-rose-700"} print:hidden`}>
          {message.text}
        </span>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4 print:hidden" onClick={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{LABEL[kind]}</h2>
            {!draft && !message && <p className="mt-4 text-sm text-slate-500">準備中...</p>}
            {draft && (
              <div className="mt-4 space-y-3">
                {draft.mode === "test" && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    メール送信がまだ設定されていないため、テストモードです(送らずに送信履歴へ記録だけします)。
                    <Link href="/email" className="ml-1 underline">
                      メール設定へ
                    </Link>
                  </p>
                )}
                <label className="block text-xs text-slate-500">
                  宛先
                  <input
                    type="email"
                    value={draft.to}
                    onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                    placeholder="customer@example.com"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="block text-xs text-slate-500">
                  件名
                  <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-slate-900" />
                </label>
                <label className="block text-xs text-slate-500">
                  本文(書類を見るためのリンクが入っています。リンクは消さないでください)
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    rows={14}
                    className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-900"
                  />
                </label>
              </div>
            )}
            {message && !message.ok && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{message.text}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                やめる
              </button>
              {draft && (
                <button type="button" onClick={send} disabled={busy || !draft.to.trim()} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                  {busy ? "送信中..." : "送信する"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
