"use client";

import { useState } from "react";

type User = { id: string; name: string; email: boolean };
type Room = { facility: string; start: string; end: string } | null;
type Visitor = { id: string; date: string; time: string | null; visitorName: string; visitorCompany: string | null; hostUserId: string | null; hostName: string | null; purpose: string | null; status: string; arrivedAt: string | null; leftAt: string | null; thanksSentAt?: string | null; room?: Room };
type Thanks = { id: string; to: string; subject: string; body: string; mode: "claude" | "template" };
type Draft = { date: string; time: string | null; visitorName: string; visitorCompany: string | null; partyKind: string | null; partyId: string | null; hostUserId: string | null; purpose: string };

const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const WEEK = "日月火水木金土";
const dayLabel = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${WEEK[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }) : "");
const label = (v: { visitorName: string; visitorCompany: string | null }) => `${v.visitorCompany ? `${v.visitorCompany} ` : ""}${v.visitorName}様`;

export default function VisitorView({ initial, users, viewerId, today, ai = false }: { initial: Visitor[]; users: User[]; viewerId: string; today: string; ai?: boolean }) {
  const [visitors, setVisitors] = useState(initial);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [thanks, setThanks] = useState<Thanks | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
    return data;
  }
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  }
  const reload = async () => setVisitors((await call("/api/visitors", "GET")).visitors);

  const parse = () =>
    run("parse", async () => {
      setDraft((await call("/api/visitors/parse", "POST", { text })).draft);
    });
  const save = () =>
    run("save", async () => {
      const { visitor } = await call("/api/visitors", "POST", draft);
      setFlash(`${dayLabel(visitor.date)}${visitor.time ? ` ${visitor.time}` : ""} ${label(visitor)}の予定を入れました`);
      setDraft(null);
      setText("");
      await reload();
    });
  const setStatus = (v: Visitor, status: string) =>
    run(v.id, async () => {
      const data = await call(`/api/visitors/${v.id}`, "PATCH", { status });
      if (status === "ARRIVED") setFlash(`${label(v)}がお見えになりました${data.notified ? `(${v.hostName}さんにメールで知らせました)` : ""}`);
      setVisitors((list) => (status === "CANCELLED" ? list.filter((x) => x.id !== v.id) : list.map((x) => (x.id === v.id ? { ...x, ...data.visitor, room: x.room } : x))));
    });

  const draftThanks = (v: Visitor, useAi: boolean) =>
    run(`thanks-${useAi ? "ai" : "make"}`, async () => {
      const d = await call(`/api/visitors/${v.id}/thanks`, "POST", { useAi });
      setThanks({ id: v.id, to: d.to ?? "", subject: d.subject, body: d.body, mode: d.mode });
    });
  const sendThanks = () =>
    run("thanks-send", async () => {
      if (!thanks) return;
      const { visitor } = await call(`/api/visitors/${thanks.id}/thanks`, "POST", { send: true, to: thanks.to, subject: thanks.subject, body: thanks.body });
      setVisitors((list) => list.map((x) => (x.id === thanks.id ? { ...x, thanksSentAt: visitor.thanksSentAt } : x)));
      setFlash(`${thanks.to} にお礼のメールを送りました`);
      setThanks(null);
    });

  const todays = visitors.filter((v) => v.date === today);
  const upcoming = visitors.filter((v) => v.date > today);
  const past = visitors.filter((v) => v.date < today).reverse();
  const order: Record<string, number> = { ARRIVED: 0, EXPECTED: 1, LEFT: 2 };
  const row = (v: Visitor, withDate: boolean) => (
    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="w-24 shrink-0 tabular-nums text-slate-600">
        {withDate ? `${dayLabel(v.date)} ` : ""}
        {v.time ?? "時刻なし"}
      </span>
      <span className="font-medium">{label(v)}</span>
      {v.purpose && <span className="text-slate-600">{v.purpose}</span>}
      <span className={`text-xs ${v.hostUserId === viewerId ? "font-medium text-indigo-700" : "text-slate-500"}`}>担当: {v.hostName ?? "決めていない"}</span>
      {v.room && (
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800 ring-1 ring-sky-200">
          {v.room.facility} {v.room.start}〜{v.room.end}
        </span>
      )}
      {v.status === "ARRIVED" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">{hm(v.arrivedAt)} お見えになっている</span>}
      {v.status === "LEFT" && (
        <span className="text-xs text-slate-500">
          {hm(v.arrivedAt)}〜{hm(v.leftAt)} お帰りになった
        </span>
      )}
      <span className="ml-auto flex gap-2">
        {v.status === "EXPECTED" && v.date <= today && (
          <button onClick={() => setStatus(v, "ARRIVED")} disabled={!!busy} className="rounded-md bg-vermilion-600 px-3 py-1 text-xs font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            お見えになった
          </button>
        )}
        {v.status === "ARRIVED" && (
          <button onClick={() => setStatus(v, "LEFT")} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
            お帰りになった
          </button>
        )}
        {v.status !== "EXPECTED" && v.date === today && (
          <button onClick={() => setStatus(v, "EXPECTED")} disabled={!!busy} className="text-xs text-slate-500 hover:underline">
            戻す
          </button>
        )}
        {v.status === "EXPECTED" && (
          <button onClick={() => setStatus(v, "CANCELLED")} disabled={!!busy} className="text-xs text-slate-500 hover:text-rose-700">
            取り消す
          </button>
        )}
        {v.status === "LEFT" &&
          (v.thanksSentAt ? (
            <span className="text-xs text-emerald-700">お礼のメール済み</span>
          ) : (
            <button onClick={() => draftThanks(v, false)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
              お礼のメール
            </button>
          ))}
      </span>
      {thanks?.id === v.id && (
        <div className="mt-2 w-full space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{thanks.mode === "claude" ? "AIが用件に合わせて書きました" : "決まった形で書きました"}(直せます)</span>
            {ai && (
              <button onClick={() => draftThanks(v, true)} disabled={!!busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy === "thanks-ai" ? "AIが書いています…" : "AIで書き直す"}
              </button>
            )}
          </div>
          <input aria-label="宛先" type="email" placeholder="宛先のメールアドレス" value={thanks.to} onChange={(e) => setThanks({ ...thanks, to: e.target.value })} className={input} />
          <input aria-label="件名" value={thanks.subject} onChange={(e) => setThanks({ ...thanks, subject: e.target.value })} className={input} />
          <textarea aria-label="本文" value={thanks.body} onChange={(e) => setThanks({ ...thanks, body: e.target.value })} rows={11} className={`${input} leading-relaxed`} />
          <div className="flex flex-wrap gap-2">
            <button onClick={sendThanks} disabled={!!busy || !thanks.to.trim()} className="rounded-md bg-vermilion-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              {busy === "thanks-send" ? "送っています…" : "送る"}
            </button>
            <button onClick={() => setThanks(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              閉じる
            </button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && parse()} placeholder="例: 明日14時 さくら商事 佐藤様 山田さん宛 打ち合わせ" className={input} />
          <button onClick={parse} disabled={!!busy || !text.trim()} className="shrink-0 rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy === "parse" ? "読み取っています…" : "読み取る"}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[9rem_6rem_1fr_1fr] sm:items-center">
              <input aria-label="日付" type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} className={input} />
              <input aria-label="時刻" type="time" value={draft.time ?? ""} onChange={(e) => setDraft({ ...draft, time: e.target.value || null })} className={input} />
              <input aria-label="会社名" placeholder="会社名" value={draft.visitorCompany ?? ""} onChange={(e) => setDraft({ ...draft, visitorCompany: e.target.value, partyKind: null, partyId: null })} className={input} />
              <input aria-label="お名前" placeholder="お名前(様はいりません)" value={draft.visitorName} onChange={(e) => setDraft({ ...draft, visitorName: e.target.value })} className={input} />
            </div>
            <div className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-center">
              <select aria-label="担当" value={draft.hostUserId ?? ""} onChange={(e) => setDraft({ ...draft, hostUserId: e.target.value || null })} className={input}>
                <option value="">担当: 決めていない</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    担当: {u.name}
                    {u.email ? "" : "(メールなし)"}
                  </option>
                ))}
              </select>
              <input aria-label="用件" placeholder="用件(例: 打ち合わせ・面接)" value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} className={input} />
              <button onClick={save} disabled={!!busy} className="rounded-md bg-vermilion-600 px-4 py-2 font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
                {busy === "save" ? "入れています…" : "予定に入れる"}
              </button>
            </div>
          </div>
        )}
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">{error}</p>}
        {flash && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{flash}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">今日の来客({dayLabel(today)})</h2>
        {todays.length ? <ul className="mt-2 divide-y divide-slate-100">{[...todays].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3)).map((v) => row(v, false))}</ul> : <p className="mt-2 text-slate-500">今日の来客の予定はありません。</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold">これからの来客(1週間)</h2>
        {upcoming.length ? <ul className="mt-2 divide-y divide-slate-100">{upcoming.map((v) => row(v, true))}</ul> : <p className="mt-2 text-slate-500">予定はありません。</p>}
      </section>

      {past.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <button onClick={() => setShowPast(!showPast)} className="font-semibold hover:underline">
            これまでの来客(30日・{past.length}件){showPast ? " ▲" : " ▼"}
          </button>
          {showPast && <ul className="mt-2 divide-y divide-slate-100">{past.map((v) => row(v, true))}</ul>}
        </section>
      )}
    </div>
  );
}
