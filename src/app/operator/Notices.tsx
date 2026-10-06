"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Notice = { id: string; title: string; body: string | null; level: string; startsAt: string; endsAt: string | null; showing: boolean };
const when = (d: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

// 運営からのお知らせ: ログインした全員の画面の上に出す(メンテナンス・新機能など)
export function Notices({ notices }: { notices: Notice[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/operator/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "出せませんでした");
    form.reset();
    router.refresh();
  }

  async function end(n: Notice) {
    if (!confirm(`「${n.title}」の表示を終えますか?`)) return;
    await fetch(`/api/operator/notices/${n.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">お知らせを出す</h2>
        {error && <p className="text-rose-600">{error}</p>}
        <input name="title" required maxLength={100} placeholder="見出し(例: 10月20日 2:00〜4:00 にメンテナンスを行います)" className="w-full rounded-md border px-3 py-2" />
        <textarea name="body" maxLength={1000} rows={3} placeholder="くわしい内容(任意)" className="w-full rounded-md border px-3 py-2" />
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1">
            <input type="radio" name="level" value="info" defaultChecked /> お知らせ
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="level" value="warning" /> 重要(メンテナンス・障害)
          </label>
          <label className="flex items-center gap-2">
            表示を終える日時(任意)
            <input type="datetime-local" name="endsAt" className="rounded-md border px-2 py-1" />
          </label>
        </div>
        <button disabled={busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          全員に出す
        </button>
        <p className="text-xs text-slate-500">ログインしているすべての会社・ユーザー(スタッフアプリを含む)の画面の上に出ます。見た人は「×」で閉じられます。</p>
      </form>
      <div className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
        {notices.map((n) => {
          const showing = n.showing;
          return (
            <div key={n.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
              <div>
                <p className="font-medium">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${showing ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{showing ? "表示中" : "終了"}</span>
                  {n.level === "warning" && "【重要】"}
                  {n.title}
                </p>
                <p className="text-xs text-slate-500">
                  {when(n.startsAt)}〜{n.endsAt ? when(n.endsAt) : ""}
                </p>
              </div>
              {showing && (
                <button onClick={() => end(n)} className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                  表示を終える
                </button>
              )}
            </div>
          );
        })}
        {notices.length === 0 && <p className="px-4 py-6 text-center text-slate-400">まだお知らせはありません。</p>}
      </div>
    </div>
  );
}
