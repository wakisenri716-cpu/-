"use client";

import { useCallback, useEffect, useState } from "react";
import { formatClock, formatMinutes } from "@/lib/shifts/pay";

type Status = "off" | "working" | "break";
type Action = "in" | "breakStart" | "breakEnd" | "out";
type StaffCard = {
  id: string;
  name: string;
  status: Status;
  since: string | null;
  forgotClockOut: string | null;
  workedMinutesToday: number;
  plans: { startMinutes: number; endMinutes: number }[];
};
type Board = { today: string; staff: StaffCard[] };

const STATUS_STYLE: Record<Status, { label: string; badge: string; card: string }> = {
  off: { label: "勤務外", badge: "bg-slate-100 text-slate-600", card: "border-slate-200" },
  working: { label: "勤務中", badge: "bg-emerald-100 text-emerald-800", card: "border-emerald-300" },
  break: { label: "休憩中", badge: "bg-amber-100 text-amber-800", card: "border-amber-300" },
};

const ACTIONS: Record<Status, { action: Action; label: string; className: string }[]> = {
  off: [{ action: "in", label: "出勤", className: "bg-emerald-600 hover:bg-emerald-700" }],
  working: [
    { action: "breakStart", label: "休憩開始", className: "bg-amber-500 hover:bg-amber-600" },
    { action: "out", label: "退勤", className: "bg-indigo-600 hover:bg-indigo-700" },
  ],
  break: [
    { action: "breakEnd", label: "休憩終了", className: "bg-amber-500 hover:bg-amber-600" },
    { action: "out", label: "退勤", className: "bg-indigo-600 hover:bg-indigo-700" },
  ],
};

const DONE_LABEL: Record<Action, string> = { in: "出勤", breakStart: "休憩開始", breakEnd: "休憩終了", out: "退勤" };

const TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const TIME_S = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DATE = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" });

export default function TimeClockPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/timeclock");
    setBoard(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount plus a periodic refresh so a shared tablet stays current;
    // setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const refresh = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  async function punch(staff: StaffCard, action: Action) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/timeclock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: staff.id, action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "打刻に失敗しました");
      setBoard(body);
      setMessage(`${staff.name}さん ${DONE_LABEL[action]}しました(${TIME.format(new Date())})`);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  const selectedStaff = board?.staff.find((s) => s.id === selected) ?? null;

  return (
    <div className={`space-y-6 ${selectedStaff ? "pb-32" : ""}`}>
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <div className="text-sm text-slate-500">{now ? DATE.format(now) : " "}</div>
        <div className="mt-1 text-4xl font-semibold tracking-wider text-slate-900 tabular-nums sm:text-5xl">
          {now ? TIME_S.format(now) : " "}
        </div>
        <p className="mt-2 text-xs text-slate-500">自分の名前を押して、出勤・休憩・退勤を記録してください。</p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-3 text-center text-base font-medium text-emerald-800">{message}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {board?.staff.map((s) => {
          const style = STATUS_STYLE[s.status];
          return (
            <button
              key={s.id}
              onClick={() => {
                setSelected(s.id === selected ? null : s.id);
                setError(null);
                setMessage(null);
              }}
              className={`rounded-xl border-2 bg-white p-4 text-left shadow-sm transition hover:shadow ${style.card} ${
                s.id === selected ? "ring-2 ring-indigo-500 ring-offset-2" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-lg font-semibold text-slate-900">{s.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style.badge}`}>{style.label}</span>
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                {s.since && (
                  <div>
                    {s.status === "break" ? "休憩開始" : "出勤"} {TIME.format(new Date(s.since))}
                  </div>
                )}
                <div>
                  予定 {s.plans.length ? s.plans.map((p) => `${formatClock(p.startMinutes)}-${formatClock(p.endMinutes)}`).join(", ") : "なし"}
                </div>
                {s.workedMinutesToday > 0 && <div>本日の勤務 {formatMinutes(s.workedMinutesToday)}</div>}
                {s.forgotClockOut && <div className="font-medium text-rose-600">前回の退勤が未打刻です</div>}
              </div>
            </button>
          );
        })}
      </div>

      {board && board.staff.length === 0 && (
        <p className="text-center text-sm text-slate-500">「シフト管理」でスタッフを登録すると、ここに表示されます。</p>
      )}

      {selectedStaff && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
            <span className="text-base font-semibold">{selectedStaff.name}さん</span>
            <div className="flex flex-1 justify-end gap-3">
              {ACTIONS[selectedStaff.status].map((a) => (
                <button
                  key={a.action}
                  onClick={() => punch(selectedStaff, a.action)}
                  disabled={busy}
                  className={`min-w-[7rem] rounded-xl px-6 py-4 text-lg font-semibold text-white shadow-sm disabled:opacity-50 ${a.className}`}
                >
                  {a.label}
                </button>
              ))}
              <button onClick={() => setSelected(null)} className="rounded-xl border px-4 py-4 text-sm text-slate-600 hover:bg-slate-50">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
