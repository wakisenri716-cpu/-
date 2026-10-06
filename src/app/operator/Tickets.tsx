"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Ticket = { id: string; name: string; email: string; category: string; subject: string; body: string; status: string; reply: string | null; repliedAt: string | null; createdAt: string; companyName: string | null };

const CATEGORY: Record<string, string> = { USAGE: "使い方", BILLING: "料金・契約", BUG: "不具合・エラー", ACCOUNT: "アカウント・ログイン", DELETE: "アカウント・データの削除", OTHER: "その他" };
const when = (d: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

// お問い合わせの一覧と返信(返信はメールで送り、対応済みにする)
export function Tickets({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(id: string, body: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/operator/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return;
    }
    setOpen(null);
    setReply("");
    router.refresh();
  }

  if (!tickets.length) return <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">お問い合わせはありません。</p>;
  return (
    <div className="space-y-3">
      {tickets.map((t) => (
        <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${t.status === "OPEN" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{t.status === "OPEN" ? "未対応" : "対応済み"}</span>
                {t.subject}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {CATEGORY[t.category] ?? t.category} ・ {t.name}({t.email}){t.companyName && ` ・ ${t.companyName}`} ・ {when(t.createdAt)}
              </p>
            </div>
            <div className="flex gap-3 text-xs">
              <button onClick={() => setOpen(open === t.id ? null : t.id)} className="text-indigo-700 hover:underline">
                返信する
              </button>
              <button disabled={busy} onClick={() => send(t.id, { action: t.status === "OPEN" ? "close" : "reopen" })} className="text-slate-500 hover:underline">
                {t.status === "OPEN" ? "対応済みにする" : "未対応に戻す"}
              </button>
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-slate-700">{t.body}</p>
          {t.reply && (
            <div className="mt-2 rounded-md bg-slate-50 p-3 text-slate-600">
              <p className="text-xs text-slate-500">返信({t.repliedAt ? when(t.repliedAt) : ""})</p>
              <p className="whitespace-pre-wrap">{t.reply}</p>
            </div>
          )}
          {open === t.id && (
            <div className="mt-3 space-y-2">
              {error && <p className="text-rose-600">{error}</p>}
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={6} className="w-full rounded-md border px-3 py-2" placeholder={`${t.name} 様あての返信(メールで送ります。お問い合わせの内容は下に自動で付きます)`} />
              <button disabled={busy || reply.trim().length < 2} onClick={() => send(t.id, { action: "reply", reply })} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy ? "送信中..." : "メールで返信して対応済みにする"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
