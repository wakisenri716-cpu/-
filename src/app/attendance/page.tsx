"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatClock, formatMinutes } from "@/lib/shifts/pay";
import { PrintButton } from "@/components/PrintButton";

type Plan = { staffId: string; date: string; startMinutes: number; endMinutes: number; breakMinutes: number };
type Rec = {
  id: string;
  staffId: string;
  date: string;
  startMinutes: number;
  endMinutes: number | null;
  breakMinutes: number;
  onBreak: boolean;
  forgotClockOut: boolean;
  edited: boolean;
};
type Week = { weekStart: string; days: string[]; today: string; staff: { id: string; name: string; active: boolean }[]; plans: Plan[]; records: Rec[] };
type Draft = { id?: string; staffId: string; date: string; start: string; end: string; breakMinutes: string };

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftKey(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shortDate(key: string) {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
}

function toTimeInput(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function worked(start: number, end: number, breakMinutes: number) {
  return Math.max(0, end - start - breakMinutes);
}

const inputClass = "w-full rounded-md border px-2.5 py-1.5 text-sm";

export default function AttendancePage() {
  const [weekKey, setWeekKey] = useState(todayKey);
  const [week, setWeek] = useState<Week | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance?week=${weekKey}`);
    setWeek(await res.json());
  }, [weekKey]);

  useEffect(() => {
    // Fetch-on-mount/week change: the resulting setState always lands after
    // the fetch's await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "保存に失敗しました");
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const body = JSON.stringify({ ...draft, breakMinutes: Number(draft.breakMinutes || 0) });
    send(draft.id ? `/api/attendance/${draft.id}` : "/api/attendance", { method: draft.id ? "PUT" : "POST", body });
  }

  const totals = (staffId: string) => {
    const plan = week?.plans.filter((p) => p.staffId === staffId).reduce((s, p) => s + worked(p.startMinutes, p.endMinutes, p.breakMinutes), 0) ?? 0;
    const actual =
      week?.records
        .filter((r) => r.staffId === staffId && r.endMinutes !== null)
        .reduce((s, r) => s + worked(r.startMinutes, r.endMinutes!, r.breakMinutes), 0) ?? 0;
    return { plan, actual };
  };

  const issues = week?.records.filter((r) => r.forgotClockOut).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">勤怠一覧</h1>
          <PrintButton variant="outline" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          シフトの予定(灰色)とタイムカードの打刻(太字)を並べて確認できます。打刻を押して修正したり、打刻忘れの日に追加したりできます。
          人件費は、打刻がある日は実績で、ない日は予定で計算されます。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {issues > 0 && (
        <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">
          退勤の打刻がない記録が{issues}件あります。赤い枠の記録を押して退勤時刻を入れてください。
        </div>
      )}

      <div className="flex items-center gap-1">
        <button onClick={() => setWeekKey(shiftKey(week?.weekStart ?? weekKey, -7))} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-white">
          ◀
        </button>
        <span className="min-w-[9rem] text-center text-sm font-medium whitespace-nowrap">
          {week ? `${week.days[0].replaceAll("-", "/")} 〜 ${shortDate(week.days[6])}` : ""}
        </span>
        <button onClick={() => setWeekKey(shiftKey(week?.weekStart ?? weekKey, 7))} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-white">
          ▶
        </button>
        <button onClick={() => setWeekKey(todayKey())} className="ml-1 rounded-md px-2.5 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50">
          今週
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-28 px-3 py-2 text-left">スタッフ</th>
                {week?.days.map((d, i) => (
                  <th key={d} className={`px-1 py-2 font-medium ${i === 5 ? "text-sky-700" : i === 6 ? "text-rose-600" : ""} ${d === week.today ? "bg-indigo-50" : ""}`}>
                    {shortDate(d)}({WEEKDAYS[i]})
                  </th>
                ))}
                <th className="w-28 px-3 py-2 text-right">予定 / 実績</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {week?.staff.map((person) => {
                const t = totals(person.id);
                return (
                  <tr key={person.id} className="align-top hover:bg-transparent">
                    <td className={`px-3 py-2 font-medium ${person.active ? "" : "text-slate-400"}`}>{person.name}</td>
                    {week.days.map((d) => {
                      const plans = week.plans.filter((p) => p.staffId === person.id && p.date === d);
                      const recs = week.records.filter((r) => r.staffId === person.id && r.date === d);
                      const plan = plans[0];
                      const first = recs[0];
                      const lastEnd = recs.length ? recs[recs.length - 1].endMinutes : null;
                      const late = plan && first ? first.startMinutes - plan.startMinutes : 0;
                      const lastPlan = plans[plans.length - 1];
                      const early = lastPlan && lastEnd !== null && lastEnd !== undefined ? lastPlan.endMinutes - lastEnd : 0;
                      const absent = plan && recs.length === 0 && d < week.today;
                      return (
                        <td key={d} className={`px-1 py-1.5 text-xs ${d === week.today ? "bg-indigo-50/40" : ""}`}>
                          {plans.map((p, i) => (
                            <div key={i} className="px-1 text-slate-400">
                              予 {formatClock(p.startMinutes)}-{formatClock(p.endMinutes)}
                            </div>
                          ))}
                          {recs.map((r) => (
                            <button
                              key={r.id}
                              onClick={() =>
                                setDraft({
                                  id: r.id,
                                  staffId: r.staffId,
                                  date: r.date,
                                  start: toTimeInput(r.startMinutes),
                                  end: r.endMinutes === null ? "" : toTimeInput(r.endMinutes),
                                  breakMinutes: String(r.breakMinutes),
                                })
                              }
                              className={`mt-0.5 block w-full rounded-md border px-1 py-0.5 text-left hover:shadow-sm ${
                                r.forgotClockOut ? "border-rose-300 bg-rose-50" : r.endMinutes === null ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"
                              }`}
                            >
                              <span className="font-semibold whitespace-nowrap text-slate-900">
                                {formatClock(r.startMinutes)}-{r.endMinutes === null ? (r.forgotClockOut ? "未打刻" : r.onBreak ? "休憩中" : "勤務中") : formatClock(r.endMinutes)}
                              </span>
                              {r.breakMinutes > 0 && <span className="block text-[11px] text-slate-500">休憩{r.breakMinutes}分</span>}
                              {r.edited && <span className="block text-[11px] text-indigo-600">修正済み</span>}
                            </button>
                          ))}
                          <div className="mt-0.5 space-y-0.5 px-1">
                            {late > 0 && <div className="text-amber-700">遅刻 {late}分</div>}
                            {early > 0 && <div className="text-amber-700">早退 {early}分</div>}
                            {absent && <div className="text-rose-600">打刻なし</div>}
                          </div>
                          <button
                            onClick={() => setDraft({ staffId: person.id, date: d, start: plan ? toTimeInput(plan.startMinutes) : "09:00", end: plan ? toTimeInput(plan.endMinutes) : "18:00", breakMinutes: String(plan?.breakMinutes ?? 60) })}
                            className="mt-1 block w-full rounded-md border border-dashed border-slate-200 py-0.5 text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
                            aria-label={`${person.name}さん ${d} の打刻を追加`}
                          >
                            +
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                      <div className="text-slate-400">{formatMinutes(t.plan)}h</div>
                      <div className="font-semibold text-slate-900">{formatMinutes(t.actual)}h</div>
                    </td>
                  </tr>
                );
              })}
              {week && week.staff.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    「シフト管理」でスタッフを登録してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setDraft(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold">
              {week?.staff.find((s) => s.id === draft.staffId)?.name}さん・{shortDate(draft.date)} の打刻を{draft.id ? "修正" : "追加"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">出勤</label>
                <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">退勤(空欄なら勤務中)</label>
                <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">休憩(分)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.breakMinutes}
                onChange={(e) => setDraft({ ...draft, breakMinutes: e.target.value })}
                className={inputClass}
              />
            </div>
            <p className="text-xs text-slate-500">退勤が出勤より前の時刻なら、翌日の退勤として扱います。修正した記録には「修正済み」と表示されます。</p>
            <div className="flex items-center justify-between gap-2 pt-1">
              {draft.id ? (
                <button
                  type="button"
                  onClick={() => send(`/api/attendance/${draft.id}`, { method: "DELETE" })}
                  disabled={busy}
                  className="text-sm text-rose-600 hover:underline disabled:opacity-50"
                >
                  削除
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
