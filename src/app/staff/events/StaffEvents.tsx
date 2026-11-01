"use client";

import { useEffect, useState } from "react";

type Mine = { answer: string; comment: string | null; paid: boolean } | null;
type Event = { id: string; title: string; date: string; time: string | null; place: string | null; fee: number | null; deadline: string | null; closed: boolean; mine: Mine };

const ANSWERS = [
  ["YES", "出席"],
  ["NO", "欠席"],
  ["MAYBE", "未定"],
] as const;
const jp = (k: string) => `${Number(k.slice(5, 7))}月${Number(k.slice(8, 10))}日(${"日月火水木金土"[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;

export function StaffEvents() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/staff-app/events")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]));
  }, []);

  async function answer(e: Event, value: string) {
    setBusy(e.id);
    setError(null);
    const res = await fetch("/api/staff-app/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: e.id, answer: value, comment: comments[e.id] ?? e.mine?.comment ?? "" }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(json.error || "答えられませんでした");
    setEvents((list) => (list ?? []).map((x) => (x.id === e.id ? { ...x, mine: { answer: json.answer.answer, comment: json.answer.comment, paid: json.answer.paid } } : x)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">社内のイベント</h1>
        <p className="mt-1 text-sm text-slate-600">忘年会・歓迎会などの出欠を答えます。あとから変えることもできます。</p>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {events === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : events.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">これからのイベントはありません。</p>
      ) : (
        events.map((e) => (
          <section key={e.id} className="space-y-3 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
            <div>
              <h2 className="text-base font-semibold">{e.title}</h2>
              <p className="text-slate-600">
                {jp(e.date)}
                {e.time ? ` ${e.time}から` : ""}
                {e.place ? `・${e.place}` : ""}
              </p>
              {e.fee ? <p className="text-slate-600">会費 {e.fee.toLocaleString()}円{e.mine?.paid ? "(受け取り済み)" : ""}</p> : null}
              {e.deadline && <p className="text-xs text-slate-500">締め切り {jp(e.deadline)}</p>}
            </div>
            {e.closed ? (
              <p className="text-xs text-slate-500">出欠は締め切りました{e.mine ? `(あなたの答え: ${ANSWERS.find(([k]) => k === e.mine!.answer)?.[1]})` : ""}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {ANSWERS.map(([k, label]) => (
                    <button key={k} onClick={() => answer(e, k)} disabled={busy === e.id} className={`rounded-xl px-3 py-2.5 font-medium ring-1 ${e.mine?.answer === k ? "bg-vermilion-600 text-white ring-vermilion-600" : "bg-white text-slate-700 ring-slate-300"} disabled:opacity-50`}>
                      {label}
                    </button>
                  ))}
                </div>
                <input value={comments[e.id] ?? e.mine?.comment ?? ""} onChange={(ev) => setComments({ ...comments, [e.id]: ev.target.value })} maxLength={100} placeholder="ひとこと(任意・例: 30分遅れます)" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                {e.mine && <p className="text-xs text-emerald-700">「{ANSWERS.find(([k]) => k === e.mine!.answer)?.[1]}」で答えました</p>}
              </>
            )}
          </section>
        ))
      )}
    </div>
  );
}
