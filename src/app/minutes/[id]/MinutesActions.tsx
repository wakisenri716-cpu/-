"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MinutesActions({ id, posted, actions }: { id: string; posted: boolean; actions: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(url: string, method: string, body?: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      return data;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "うまくいきませんでした");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function announce() {
    const data = await run(`/api/minutes/${id}/announce`, "POST", { notify });
    if (data) {
      setMessage(data.mailed ? `お知らせに載せ、${data.mailed}人にメールしました` : "お知らせに載せました");
      router.refresh();
    }
  }

  async function toTasks() {
    const data = await run(`/api/minutes/${id}/tasks`, "POST", { notify });
    if (data) setMessage(data.tasks.length ? `やることリストに${data.tasks.length}件入れました${data.mailed ? `(${data.mailed}人にメール)` : ""}` : "もう全部入っています");
  }

  async function remove() {
    if (!confirm("この議事録を削除しますか?")) return;
    if (await run(`/api/minutes/${id}`, "DELETE")) {
      router.push("/minutes");
      router.refresh();
    }
  }

  return (
    <>
      {message && <span className="text-sm text-slate-700">{message}</span>}
      {actions > 0 && (
        <button onClick={toTasks} disabled={busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          やることリストに入れる
        </button>
      )}
      {posted ? (
        <Link href="/notices" className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
          お知らせ済み
        </Link>
      ) : (
        <span className="inline-flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-indigo-700" />
            メールでも
          </label>
          <button onClick={announce} disabled={busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            お知らせに載せる
          </button>
        </span>
      )}
      <Link href={`/minutes/${id}/edit`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
        直す
      </Link>
      <button onClick={remove} disabled={busy} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
        削除
      </button>
    </>
  );
}
