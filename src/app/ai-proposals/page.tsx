"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ProposalCard, type Proposal } from "../assistant/ProposalCard";

type Row = Proposal & { source: "ASSISTANT" | "MCP"; sourceName: string | null; requestedBy: string | null; createdAt: string; expiresAt: string };

const time = (s: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(s));

// AIが作った下書き(AIアシスタント・自分のAIからつないだもの)を確かめて、実行する・やめる
export default function AiProposalsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/assistant/proposals");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error || "読み込めませんでした");
    else setRows(body);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const pending = rows?.filter((r) => r.status === "PENDING") ?? [];
  const decided = rows?.filter((r) => r.status !== "PENDING") ?? [];
  const note = (r: Row) => `${r.source === "MCP" ? `自分のAI「${r.sourceName ?? ""}」` : "AIアシスタント"}から ・ ${r.requestedBy ?? ""} ・ ${time(r.createdAt)}${r.status === "PENDING" ? `(${time(r.expiresAt)}まで)` : ""}`;
  const update = (np: Proposal) => setRows((all) => all?.map((r) => (r.id === np.id ? { ...r, ...np } : r)) ?? null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">AIからの下書き</h1>
          <p className="mt-1 text-sm text-slate-600">AIが作った請求書・仕訳・督促メール・経費などの下書きです。内容を確かめて「実行する」を押したときだけ確定します(24時間で期限切れ)。</p>
        </div>
        <button type="button" onClick={load} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          新しくする
        </button>
      </div>

      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {!rows && !error && <p className="text-sm text-slate-500">読み込み中...</p>}

      {rows && (
        <>
          <section>
            <h2 className="font-semibold">確かめ待ち({pending.length}件)</h2>
            {pending.length ? (
              pending.map((r) => <ProposalCard key={r.id} proposal={r} note={note(r)} onChange={update} />)
            ) : (
              <p className="mt-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                いま確かめ待ちの下書きはありません。
                <Link href="/assistant" className="mx-1 text-indigo-700 hover:underline">
                  AIアシスタント
                </Link>
                や、
                <Link href="/ai-settings" className="mx-1 text-indigo-700 hover:underline">
                  自分のAIからつなぐ
                </Link>
                と、ここに届きます。
              </p>
            )}
          </section>
          {decided.length > 0 && (
            <section>
              <h2 className="font-semibold text-slate-700">最近決めたもの(7日)</h2>
              {decided.map((r) => (
                <ProposalCard key={r.id} proposal={r} note={note(r)} onChange={update} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
