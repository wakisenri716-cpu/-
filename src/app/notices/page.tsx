"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Item = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  authorName: string;
  createdAt: string;
  edited: boolean;
  read: boolean;
  readCount?: number;
  memberCount?: number;
  unreadNames?: string[];
};
type Data = { canWrite: boolean; items: Item[] };

const inputClass = "mt-1 block w-full rounded-md border px-3 py-2 text-sm";
const when = (iso: string) => new Date(iso).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function NoticeForm({ item, busy, onSubmit, onCancel }: { item?: Item; busy: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel?: () => void }) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-600">件名</span>
        <input name="title" required maxLength={100} defaultValue={item?.title} placeholder="例: 年末年始の営業日について" className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">本文</span>
        <textarea name="body" required maxLength={5000} rows={5} defaultValue={item?.body} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="pinned" defaultChecked={item?.pinned} />
          上に固定する
        </label>
        {!item && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="notify" />
            メールでも知らせる(メールアドレスのある全員)
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {item ? "保存" : "お知らせを出す"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            やめる
          </button>
        )}
      </div>
    </form>
  );
}

export default function NoticesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notices");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(url: string, method: string, body?: object) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return null;
    }
    await load();
    return json;
  }

  const fields = (form: HTMLFormElement) => {
    const f = new FormData(form);
    return { title: f.get("title"), body: f.get("body"), pinned: f.get("pinned") === "on", notify: f.get("notify") === "on" };
  };

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const json = await call("/api/notices", "POST", fields(event.currentTarget));
    if (json) {
      setWriting(false);
      setMessage(json.mailed ? `お知らせを出し、${json.mailed}人にメールで知らせました` : "お知らせを出しました");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const { title, body, pinned } = fields(event.currentTarget);
    if (await call(`/api/notices/${id}`, "PATCH", { title, body, pinned })) setEditing(null);
  }

  async function toggle(item: Item) {
    const next = open === item.id ? null : item.id;
    setOpen(next);
    // 開いたら読んだことにする
    if (next && !item.read) {
      await fetch(`/api/notices/${item.id}`, { method: "POST" });
      await load();
    }
  }

  async function remove(item: Item) {
    if (!confirm(`「${item.title}」を消しますか?`)) return;
    await call(`/api/notices/${item.id}`, "DELETE");
  }

  const unread = data?.items.filter((i) => !i.read).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">社内のお知らせ</h1>
          <p className="mt-1 text-sm text-slate-600">
            会社からのお知らせです。{unread > 0 ? `まだ読んでいないお知らせが${unread}件あります。` : ""}
            {data?.canWrite && "書いたお知らせは、誰が読んだかを確かめられます。"}
          </p>
        </div>
        {data?.canWrite && !writing && (
          <button onClick={() => setWriting(true)} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            + お知らせを書く
          </button>
        )}
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {writing && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">お知らせを書く</h2>
          <NoticeForm busy={busy} onSubmit={post} onCancel={() => setWriting(false)} />
        </section>
      )}

      {data && (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <li key={item.id} className={`rounded-xl border bg-white shadow-sm ${item.read ? "border-slate-200" : "border-indigo-300"}`}>
              {editing === item.id ? (
                <div className="p-4">
                  <NoticeForm item={item} busy={busy} onSubmit={(e) => save(e, item.id)} onCancel={() => setEditing(null)} />
                </div>
              ) : (
                <>
                  <button onClick={() => toggle(item)} className="flex w-full items-start gap-3 px-4 py-3 text-left" aria-expanded={open === item.id}>
                    {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-label="未読" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {item.pinned && <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">固定</span>}
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {item.authorName} ・ {when(item.createdAt)}
                        {item.edited && "(編集済み)"}
                        {item.readCount !== undefined && ` ・ 既読 ${item.readCount}/${item.memberCount}人`}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">{open === item.id ? "閉じる" : "開く"}</span>
                  </button>
                  {open === item.id && (
                    <div className="space-y-3 border-t px-4 py-3">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.body}</p>
                      {item.unreadNames && item.unreadNames.length > 0 && <p className="text-xs text-amber-800">まだ読んでいない人: {item.unreadNames.join("、")}</p>}
                      {data.canWrite && (
                        <div className="flex gap-3 text-xs">
                          <button onClick={() => setEditing(item.id)} className="text-indigo-700 hover:underline">
                            直す
                          </button>
                          <button onClick={() => call(`/api/notices/${item.id}`, "PATCH", { pinned: !item.pinned })} disabled={busy} className="text-slate-600 hover:underline">
                            {item.pinned ? "固定をやめる" : "上に固定する"}
                          </button>
                          <button onClick={() => remove(item)} disabled={busy} className="text-slate-500 hover:text-rose-700 hover:underline">
                            消す
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
          {data.items.length === 0 && <li className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">まだお知らせはありません。</li>}
        </ul>
      )}
    </div>
  );
}
