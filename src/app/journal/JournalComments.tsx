"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Comment = { id: string; userName: string; role: string; roleLabel: string; body: string; resolved: boolean; createdAt: string };

const time = (s: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(s));

// 仕訳へのコメント(税理士からの質問と回答)。仕訳帳の行の下に開く
export function JournalComments({ entryId, onClose, onCount }: { entryId: string; onClose: () => void; onCount: (c: { total: number; open: number }) => void }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 親が描き直すたびに onCount が変わっても読み直さないよう、最新のものを ref で持つ
  const countRef = useRef(onCount);
  useEffect(() => {
    countRef.current = onCount;
  }, [onCount]);
  const apply = useCallback((list: Comment[]) => {
    setComments(list);
    countRef.current({ total: list.length, open: list.filter((c) => c.role === "ADVISOR" && !c.resolved).length });
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/journal/${entryId}/comments`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || "読み込めませんでした");
    else apply(body);
  }, [entryId, apply]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/journal/${entryId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "送れませんでした");
      return false;
    }
    apply(body);
    return true;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await post({ body: text })) setText("");
  }

  // 「この仕訳は何?」の説明を、回答の下書きとして入れる
  async function draftFromExplain() {
    setBusy(true);
    const res = await fetch(`/api/journal/${entryId}/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "説明を作れませんでした");
    setText([body.story, ...(body.points ?? []).map((p: string) => `・${p}`)].filter(Boolean).join("\n"));
  }

  const open = comments?.some((c) => c.role === "ADVISOR" && !c.resolved);
  return (
    <div className="sticky left-4 max-w-[calc(100vw-4.5rem)] rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm whitespace-normal">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-sky-800">コメント(税理士とのやりとり)</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">
          閉じる
        </button>
      </div>
      {error && <p className="mt-2 text-rose-700">{error}</p>}
      {!comments && !error && <p className="mt-2 text-slate-500">読み込み中...</p>}
      {comments && (
        <div className="mt-2 space-y-3">
          {comments.length === 0 && <p className="text-slate-500">まだコメントはありません。気になる点を書くと、会社の方(または税理士)に届きます。</p>}
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className={`rounded-lg px-3 py-2 ${c.role === "ADVISOR" ? "bg-white ring-1 ring-sky-200" : "ml-6 bg-white/70 ring-1 ring-slate-200"}`}>
                <p className="text-xs text-slate-500">
                  <span className={`mr-1 rounded px-1.5 py-0.5 ${c.role === "ADVISOR" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>{c.roleLabel}</span>
                  {c.userName} ・ {time(c.createdAt)}
                  {c.resolved && <span className="ml-1 text-emerald-700">✓ 解決済み</span>}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{c.body}</p>
              </li>
            ))}
          </ul>
          <form onSubmit={submit} className="space-y-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="質問・回答を書く" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={busy || !text.trim()} className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50">
                送る
              </button>
              <button type="button" disabled={busy} onClick={draftFromExplain} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                仕訳の説明を下書きに入れる
              </button>
              {comments.length > 0 && (
                <button type="button" disabled={busy} onClick={() => post({ resolved: !!open })} className="ml-auto text-xs text-emerald-700 hover:underline disabled:opacity-50">
                  {open ? "解決済みにする" : "未解決に戻す"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
