"use client";

import { useEffect, useState } from "react";

type Mine = { role: string; date: string; today: boolean; note: string | null };
type Role = { id: string; name: string; weekdayLabel: string; note: string | null; schedule: { date: string; name: string; me: boolean }[] };
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${"日月火水木金土"[new Date(`${k}T00:00:00Z`).getUTCDay()]})`;

export function StaffDuties() {
  const [data, setData] = useState<{ mine: Mine[]; roles: Role[] } | null>(null);
  useEffect(() => {
    fetch("/api/staff-app/duties")
      .then((r) => (r.ok ? r.json() : { mine: [], roles: [] }))
      .then(setData)
      .catch(() => setData({ mine: [], roles: [] }));
  }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">当番表</h1>
        <p className="mt-1 text-sm text-slate-600">これから2週間の当番です。当番の日の朝にお知らせします。かわってほしいときは総務に伝えてください。</p>
      </div>
      {data === null ? (
        <p className="text-sm text-slate-500">読み込んでいます…</p>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold">あなたの当番</h2>
            {data.mine.length ? (
              <ul className="mt-2 space-y-1">
                {data.mine.map((m) => (
                  <li key={`${m.role}-${m.date}`} className={m.today ? "font-semibold text-vermilion-700" : ""}>
                    {m.today ? "今日 " : ""}
                    {md(m.date)} {m.role}
                    {m.note ? <span className="ml-1 text-xs font-normal text-slate-500">{m.note}</span> : null}
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
