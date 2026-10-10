"use client";

import { useState } from "react";

type User = { id: string; name: string };
type Facts = {
  from: { id: string; name: string };
  tasks: { id: string; title: string; dueOn: string | null; repeat: string | null; overdue: boolean }[];
  memos: { id: string; from: string; message: string; urgent: boolean }[];
  mail: { id: string; title: string }[];
  deals: { id: string; title: string; customer: string; stage: string }[];
};
type Draft = { facts: Facts; to: { id: string; name: string } | null; text: string; mode: "claude" | "template" };
type Kind = "tasks" | "memos" | "mail" | "deals";

const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
const LABEL: Record<Kind, string> = { tasks: "やること", memos: "伝言", mail: "郵便物・荷物", deals: "商談" };

type Leave = { userId: string; name: string; period: string; tasks: number; memos: number; mail: number };

export default function HandoverView({ users, viewerId, ai, leaves = [] }: { users: User[]; viewerId: string; ai: boolean; leaves?: Leave[] }) {
  const [fromUserId, setFrom] = useState(users.find((u) => u.id !== viewerId)?.id ?? users[0]?.id ?? "");
  const [toUserId, setTo] = useState(viewerId);
  const [period, setPeriod] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function make(useAi: boolean, preset?: { fromUserId: string; period: string }) {
    setBusy(useAi ? "ai" : "make");
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromUserId: preset?.fromUserId ?? fromUserId, toUserId: toUserId && toUserId !== (preset?.fromUserId ?? fromUserId) ? toUserId : null, period: preset?.period ?? period, note, useAi }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      setDraft(data);
      setText(data.text);
      const f = data.facts as Facts;
      setPicked(Object.fromEntries([...f.tasks, ...f.memos, ...f.mail, ...f.deals].map((x) => [x.id, true])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function transfer() {
    if (!draft) return;
    setBusy("transfer");
    setError(null);
    try {
      const pick = (list: { id: string }[]) => list.filter((x) => picked[x.id]).map((x) => x.id);
      const f = draft.facts;
      const res = await fetch("/api/handover/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId, taskIds: pick(f.tasks), memoIds: pick(f.memos), mailIds: pick(f.mail), dealIds: pick(f.deals), text, notify }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "引き継げませんでした");
      setDone(`${data.from}さんから${data.to}さんへ、やること${data.tasks}件・伝言${data.memos}件・郵便物${data.mail}件・商談${data.deals}件を移しました${data.mailed ? "(引き継ぎメモをメールで送りました)" : ""}`);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "引き継げませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone("引き継ぎメモをコピーしました");
    } catch {
      setError("コピーできませんでした。本文を選んでコピーしてください");
    }
  }

  const lists: { kind: Kind; items: { id: string; label: string; hot: boolean }[] }[] = draft
    ? [
        { kind: "tasks" as Kind, items: draft.facts.tasks.map((t) => ({ id: t.id, label: `${t.dueOn ? `${Number(t.dueOn.slice(5, 7))}/${Number(t.dueOn.slice(8, 10))} ` : ""}${t.title}${t.repeat ? `(${t.repeat})` : ""}`, hot: t.overdue })) },
        { kind: "memos" as Kind, items: draft.facts.memos.map((m) => ({ id: m.id, label: `${m.from}: ${m.message.slice(0, 40)}`, hot: m.urgent })) },
        { kind: "mail" as Kind, items: draft.facts.mail.map((m) => ({ id: m.id, label: m.title, hot: false })) },
        { kind: "deals" as Kind, items: draft.facts.deals.map((d) => ({ id: d.id, label: `${d.customer} ${d.title}(${d.stage})`, hot: false })) },
      ].filter((l) => l.items.length)
    : [];
  const count = Object.values(picked).filter(Boolean).length;

  // 近いうちに休む人を選ぶと、その人と期間を入れて引き継ぎメモを作る
  function pickLeave(l: Leave) {
    setFrom(l.userId);
    setPeriod(l.period);
    if (toUserId === l.userId) setTo("");
    void make(false, { fromUserId: l.userId, period: l.period });
  }

  return (
    <div className="space-y-6">
      {leaves.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-amber-900">近いうちに休む人(2週間)</h2>
          <ul className="mt-2 space-y-1.5">
            {leaves.map((l) => (
              <li key={l.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{l.name}</span>
                <span className="text-slate-600">{l.period}</span>
                <span className="text-xs text-slate-500">
                  やること{l.tasks}・伝言{l.memos}・郵便物{l.mail}
                </span>
                <button onClick={() => pickLeave(l)} disabled={!!busy} className="ml-auto rounded-md border border-amber-300 bg-white px-3 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  この人の引き継ぎメモを作る
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-slate-700">引き継ぐ人(休む・異動する人)</span>
            <select value={fromUserId} onChange={(e) => setFrom(e.target.value)} className={input}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-700">後任の人</span>
            <select value={toUserId} onChange={(e) => setTo(e.target.value)} className={input}>
              <option value="">まだ決めていない</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-700">期間(任意)</span>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="例: 10/14〜10/18 夏休み / 11月から異動" className={input} />
          </label>
          <label className="block">
            <span className="text-slate-700">ひとこと(任意)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: さくら商事の件は月曜に電話が来ます" className={input} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => make(false)} disabled={!!busy || !fromUserId} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "make" ? "まとめています…" : "引き継ぎメモを作る"}
          </button>
          {ai && (
            <button onClick={() => make(true)} disabled={!!busy || !fromUserId} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "ai" ? "AIがまとめています…" : "AIで要点も"}
            </button>
          )}
        </div>
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {done && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{done}</p>}
      </section>

      {draft && (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">引き継ぎメモ</h2>
              <span className="text-xs text-slate-500">{draft.mode === "claude" ? "AIが要点を添えました" : "決まった形でまとめました"}(直せます)</span>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} className={`${input} font-mono text-xs leading-relaxed`} />
            <button onClick={copy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
              コピー
            </button>
          </section>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">後任の人に移すもの</h2>
            {lists.length ? (
              lists.map((l) => (
                <div key={l.kind}>
                  <p className="text-xs font-medium text-slate-500">{LABEL[l.kind]}</p>
                  <ul className="mt-1 space-y-1">
                    {l.items.map((x) => (
                      <li key={x.id}>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" checked={!!picked[x.id]} onChange={(e) => setPicked((p) => ({ ...p, [x.id]: e.target.checked }))} className="mt-0.5" />
                          <span className={x.hot ? "text-rose-700" : ""}>{x.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="text-slate-500">移すものはありません。</p>
            )}
            {lists.length > 0 && (
              <>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                  <span>引き継ぎメモを後任の人にメールで送る</span>
                </label>
                <button onClick={transfer} disabled={!!busy || !toUserId || !count} className="w-full rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                  {busy === "transfer" ? "移しています…" : toUserId ? `${count}件を引き継ぐ` : "後任の人を選んでください"}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
