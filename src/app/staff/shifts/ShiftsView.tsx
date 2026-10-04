"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "" | "available" | "off";
type Day = {
  date: string;
  weekday: string;
  request: { available: boolean; start: string | null; end: string | null; note: string | null } | null;
  shifts: { start: string; end: string; breakMinutes: number; note: string | null }[];
};
type Data = { month: string; today: string; deadline: string | null; locked: boolean; staff: { id: string; name: string } | null; days: Day[] };
type Edit = { status: Status; start: string; end: string; note: string };

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const toEdit = (d: Day): Edit => ({ status: d.request ? (d.request.available ? "available" : "off") : "", start: d.request?.start ?? "", end: d.request?.end ?? "", note: d.request?.note ?? "" });
const dayColor = (w: string) => (w === "日" ? "text-rose-600" : w === "土" ? "text-sky-600" : "");

export function ShiftsView({ initialTab, initialMonth }: { initialTab: "request" | "confirmed"; initialMonth: string | null }) {
  const [tab, setTab] = useState(initialTab);
  const [month, setMonth] = useState<string | null>(initialMonth);
  const [data, setData] = useState<Data | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [dirty, setDirty] = useState(false);
  const [bulk, setBulk] = useState({ start: "10:00", end: "18:00" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff-app/shifts${month ? `?month=${month}` : ""}`);
    if (!res.ok) return;
    const json: Data = await res.json();
    setData(json);
    setEdits(Object.fromEntries(json.days.map((d) => [d.date, toEdit(d)])));
    setDirty(false);
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function change(date: string, patch: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [date]: { ...prev[date], ...patch } }));
    setDirty(true);
    setMessage(null);
  }

  function fillWeekdays() {
    if (!data) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const d of data.days) if (d.weekday !== "土" && d.weekday !== "日" && !next[d.date].status) next[d.date] = { ...next[d.date], status: "available", start: bulk.start, end: bulk.end };
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    const days = data.days.map((d) => ({ date: d.date, ...edits[d.date] }));
    const res = await fetch("/api/staff-app/shifts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: data.month, days }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "提出できませんでした" });
    setMessage({ ok: true, text: `${Number(data.month.slice(5))}月のシフト希望を提出しました(${json.saved}日分)` });
    await load();
  }

  if (!data) return <p className="py-10 text-center text-sm text-slate-400">読み込み中...</p>;
  const m = Number(data.month.slice(5));
  const counts = Object.values(edits).reduce((c, e) => ({ ...c, [e.status || "none"]: (c[e.status || "none"] ?? 0) + 1 }), {} as Record<string, number>);
  const confirmed = data.days.filter((d) => d.shifts.length);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">シフト</h1>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {(
            [
              ["request", "希望を出す"],
              ["confirmed", "決まったシフト"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-white px-2 py-2 shadow-sm ring-1 ring-slate-200">
        <button onClick={() => (!dirty || confirm("提出していない変更があります。月を変えますか?")) && setMonth(shiftMonth(data.month, -1))} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          ← 前の月
        </button>
        <p className="font-semibold">
          {data.month.slice(0, 4)}年{m}月
        </p>
        <button onClick={() => (!dirty || confirm("提出していない変更があります。月を変えますか?")) && setMonth(shiftMonth(data.month, 1))} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          次の月 →
        </button>
      </div>

      {!data.staff && (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          シフトを使うには、管理者に「シフト管理」でスタッフとして登録してもらい、このアカウントとひも付けてもらってください。
        </div>
      )}

      {data.staff && tab === "request" && (
        <>
          {data.deadline && (
            <p className={`rounded-xl px-4 py-2 text-sm ${data.locked ? "bg-slate-100 text-slate-600" : "bg-indigo-50 text-indigo-900"}`}>
              {data.locked ? `締め切り(${data.deadline.replaceAll("-", "/")})を過ぎたので変えられません。変えたいときは管理者に伝えてください。` : `提出の締め切り: ${data.deadline.replaceAll("-", "/")}`}
            </p>
          )}
          {!data.locked && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
              <span className="text-slate-600">まとめて:</span>
              <input type="time" value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: e.target.value })} className="w-28 rounded border px-2 py-1" aria-label="開始" />
              〜
              <input type="time" value={bulk.end} onChange={(e) => setBulk({ ...bulk, end: e.target.value })} className="w-28 rounded border px-2 py-1" aria-label="終了" />
              <button onClick={fillWeekdays} className="rounded-md border border-indigo-600 px-2 py-1 text-indigo-700">
                未定の平日を「出られる」に
              </button>
            </div>
          )}
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {data.days.map((d) => {
              const e = edits[d.date];
              const past = d.date < data.today;
              return (
                <li key={d.date} className={`px-3 py-2.5 ${past ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-16 shrink-0 text-sm font-medium ${dayColor(d.weekday)}`}>
                      {Number(d.date.slice(8))}日({d.weekday})
                    </span>
                    <div className="flex flex-1 justify-end gap-1">
                      {(
                        [
                          ["", "未定", "bg-slate-600"],
                          ["available", "◯ 出られる", "bg-emerald-600"],
                          ["off", "✕ 休み", "bg-rose-600"],
                        ] as const
                      ).map(([v, label, color]) => (
                        <button
                          key={v}
                          disabled={data.locked || past}
                          onClick={() => change(d.date, { status: v })}
                          className={`rounded-full px-2.5 py-1 text-xs ${e.status === v ? `${color} text-white` : "bg-slate-100 text-slate-600"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {e.status === "available" && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-16 text-sm">
                      <input type="time" value={e.start} disabled={data.locked || past} onChange={(ev) => change(d.date, { start: ev.target.value })} className="w-28 rounded border px-2 py-1" aria-label={`${d.date} 開始`} />
                      〜
                      <input type="time" value={e.end} disabled={data.locked || past} onChange={(ev) => change(d.date, { end: ev.target.value })} className="w-28 rounded border px-2 py-1" aria-label={`${d.date} 終了`} />
                      {!e.start && !e.end && <span className="text-xs text-slate-400">空なら何時でも可</span>}
                    </div>
                  )}
                  {e.status && (
                    <input
                      value={e.note}
                      disabled={data.locked || past}
                      onChange={(ev) => change(d.date, { note: ev.target.value })}
                      maxLength={100}
                      placeholder="ひとこと(任意) 例: 午後から"
                      className="mt-2 ml-16 w-[calc(100%-4rem)] rounded border px-2 py-1 text-sm"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {!data.locked && (
            <div className="sticky bottom-20 z-10 md:bottom-4">
              {message && <p className={`mb-2 rounded-lg px-3 py-2 text-sm shadow ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</p>}
              <button onClick={save} disabled={busy} className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white shadow-lg disabled:opacity-50">
                {busy ? "提出中..." : `${m}月の希望を提出する(◯${counts.available ?? 0}日・✕${counts.off ?? 0}日)`}
              </button>
            </div>
          )}
          {data.locked && message && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message.text}</p>}
        </>
      )}

      {data.staff && tab === "confirmed" && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {confirmed.map((d) => (
            <li key={d.date} className={`flex items-center justify-between px-4 py-3 ${d.date === data.today ? "bg-indigo-50" : ""}`}>
              <span className={`text-sm font-medium ${dayColor(d.weekday)}`}>
                {Number(d.date.slice(8))}日({d.weekday}){d.date === data.today && <span className="ml-1 text-xs text-indigo-700">今日</span>}
              </span>
              <span className="text-right text-sm tabular-nums">
                {d.shifts.map((s) => (
                  <span key={s.start} className="block">
                    {s.start}〜{s.end}
                    {s.breakMinutes > 0 && <span className="ml-1 text-xs text-slate-500">休憩{s.breakMinutes}分</span>}
                  </span>
                ))}
              </span>
            </li>
          ))}
          {confirmed.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">{m}月のシフトはまだ決まっていません。</li>}
        </ul>
      )}
    </div>
  );
}
