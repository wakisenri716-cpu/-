"use client";

import { useEffect, useState } from "react";

type Mine = { roleId: string; role: string; date: string; today: boolean; note: string | null };
type Swap = { id: string; roleName: string; date: string; fromName: string; toName: string; message: string | null };
type Role = { id: string; name: string; weekdayLabel: string; note: string | null; schedule: { date: string; name: string; me: boolean }[] };
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${"日月火水木金土"[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;

export function StaffDuties() {
  type Data = { mine: Mine[]; roles: Role[]; people: { id: string; name: string }[]; swaps: { incoming: Swap[]; outgoing: Swap[] } };
  const [data, setData] = useState<Data | null>(null);
  const [ask, setAsk] = useState<{ m: Mine; toUserId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/staff-app/duties")
      .then((r) => (r.ok ? r.json() : { mine: [], roles: [], people: [], swaps: { incoming: [], outgoing: [] } }))
      .then(setData)
      .catch(() => setData({ mine: [], roles: [], people: [], swaps: { incoming: [], outgoing: [] } }));
  useEffect(() => {
    load();
  }, []);
  async function send(url: string, method: string, body: unknown, ok: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: json.error || "うまくいきませんでした" });
    setAsk(null);
    setMsg({ ok: true, text: ok });
    load();
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">当番表</h1>
        <p className="mt-1 text-sm text-slate-600">これから2週間の当番です。当番の日の朝にお知らせします。都合が悪い日は「代わってもらう」で、ほかの人に頼めます。</p>
      </div>
      {data === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : (
        <>
          {data.swaps.incoming.map((r) => (
            <section key={r.id} className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm shadow-sm">
              <p className="font-semibold text-amber-900">
                {r.fromName}さんから: {md(r.date)}の{r.roleName}を代わってもらえませんか
              </p>
              {r.message && <p className="text-amber-900">「{r.message}」</p>}
              <div className="flex gap-2">
                <button onClick={() => send(`/api/staff-app/duties/swaps/${r.id}`, "PATCH", { action: "accept" }, "引き受けました。当番表が入れかわりました")} disabled={busy} className="flex-1 rounded-xl bg-vermilion-600 px-3 py-2 font-medium text-white disabled:opacity-50">
                  引き受ける
                </button>
                <button onClick={() => send(`/api/staff-app/duties/swaps/${r.id}`, "PATCH", { action: "decline" }, "断りました")} disabled={busy} className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">
                  断る
                </button>
              </div>
            </section>
          ))}
          {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
          <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold">あなたの当番</h2>
            {data.mine.length ? (
              <ul className="mt-2 space-y-2">
                {data.mine.map((m) => (
                  <li key={`${m.role}-${m.date}`} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className={m.today ? "font-semibold text-vermilion-700" : ""}>
                        {m.today ? "今日 " : ""}
                        {md(m.date)} {m.role}
                        {m.note ? <span className="ml-1 text-xs font-normal text-slate-500">{m.note}</span> : null}
                      </span>
                      {(() => {
                        const out = data.swaps.outgoing.find((o) => o.date === m.date && o.roleName === m.role);
                        return out ? (
                          <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                            {out.toName}さんの返事待ち
                            <button onClick={() => send(`/api/staff-app/duties/swaps/${out.id}`, "PATCH", { action: "cancel" }, "お願いを取り消しました")} disabled={busy} className="text-slate-400 underline">
                              取り消す
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setAsk({ m, toUserId: "", message: "" })} className="ml-auto text-xs text-indigo-700">
                            代わってもらう
                          </button>
                        );
                      })()}
                    </div>
                    {ask && ask.m.date === m.date && ask.m.roleId === m.roleId && (
                      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                        <select aria-label="代わってほしい人" value={ask.toUserId} onChange={(e) => setAsk({ ...ask, toUserId: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2">
                          <option value="">代わってほしい人を選ぶ</option>
                          {data.people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <input aria-label="ひとこと" value={ask.message} onChange={(e) => setAsk({ ...ask, message: e.target.value })} placeholder="ひとこと(任意) 例: 通院の日なので" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                        <div className="flex gap-2">
                          <button onClick={() => send("/api/staff-app/duties/swaps", "POST", { roleId: m.roleId, date: m.date, toUserId: ask.toUserId, message: ask.message }, "お願いを送りました。返事が来たらメールで知らせます")} disabled={busy || !ask.toUserId} className="flex-1 rounded-xl bg-vermilion-600 px-3 py-2 font-medium text-white disabled:opacity-50">
                            お願いする
                          </button>
                          <button onClick={() => setAsk(null)} className="rounded-xl border border-slate-300 px-3 py-2">
                            やめる
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-slate-500">これから2週間、あなたの当番はありません。</p>
            )}
          </section>
          {data.roles.map((r) => (
            <section key={r.id} className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold">
                {r.name} <span className="text-xs font-normal text-slate-500">({r.weekdayLabel})</span>
              </h2>
              <ul className="mt-2 grid grid-cols-2 gap-1">
                {r.schedule.map((s) => (
                  <li key={s.date} className={`rounded-lg px-2 py-1 ${s.me ? "bg-vermilion-50 font-medium text-vermilion-800" : "bg-slate-50"}`}>
                    {md(s.date)} {s.name}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
