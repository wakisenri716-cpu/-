"use client";

import { useCallback, useEffect, useState } from "react";
import { formatClock, formatMinutes } from "@/lib/shifts/pay";

type Status = "off" | "working" | "break";
type Action = "in" | "breakStart" | "breakEnd" | "out";
type StaffCard = {
  id: string;
  name: string;
  hasPin: boolean;
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
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

const DATE = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" });

export default function TimeClockPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 暗証番号が設定されたスタッフは、ボタンを押した後にテンキーで4桁を入力してから打刻する
  const [pinFor, setPinFor] = useState<{ staff: StaffCard; action: Action } | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

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

  async function punch(staff: StaffCard, action: Action, enteredPin?: string) {
    setBusy(true);
    setError(null);
    setPinError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/timeclock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: staff.id, action, pin: enteredPin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "打刻に失敗しました");
      setBoard(body);
      setMessage(`${staff.name}さん ${DONE_LABEL[action]}しました(${TIME.format(new Date())})`);
      setSelected(null);
      setPinFor(null);
    } catch (e) {
      const text = e instanceof Error ? e.message : "エラーが発生しました";
      if (enteredPin !== undefined) setPinError(text);
      else setError(text);
    } finally {
      setPin("");
      setBusy(false);
    }
  }

  function startPunch(staff: StaffCard, action: Action) {
    if (!staff.hasPin) return punch(staff, action);
    setPin("");
    setPinError(null);
    setPinFor({ staff, action });
  }

  const pressKey = useCallback(
    (key: string) => {
      if (!pinFor || busy) return;
      if (key === "clear") return setPin("");
      if (key === "back") return setPin((p) => p.slice(0, -1));
      if (!/^\d$/.test(key) || pin.length >= 4) return;
      const next = pin + key;
      setPin(next);
      if (next.length === 4) punch(pinFor.staff, pinFor.action, next);
    },
    [pinFor, busy, pin],
  );

  // パソコンのキーボードからも入力できるようにする
  useEffect(() => {
    if (!pinFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinFor(null);
      else if (e.key === "Backspace") pressKey("back");
      else pressKey(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinFor, pressKey]);

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
                  onClick={() => startPunch(selectedStaff, a.action)}
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

      {pinFor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setPinFor(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="暗証番号の入力"
            className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-sm text-slate-500">
              {pinFor.staff.name}さん・{DONE_LABEL[pinFor.action]}
            </p>
            <p className="mt-1 text-center text-base font-semibold text-slate-900">暗証番号(4桁)を入力</p>
            <div className="mt-4 flex justify-center gap-3" aria-live="polite" aria-label={`${pin.length}桁入力済み`}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? "border-indigo-600 bg-indigo-600" : "border-slate-300"}`} />
              ))}
            </div>
            <p className="mt-3 min-h-[2.5rem] text-center text-sm text-rose-600">{busy ? <span className="text-slate-500">確認中...</span> : pinError}</p>
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => pressKey(k)}
                  disabled={busy}
                  className={`rounded-xl py-4 font-semibold disabled:opacity-50 ${
                    k === "clear" || k === "back" ? "bg-slate-50 text-sm text-slate-600 hover:bg-slate-100" : "bg-slate-100 text-2xl text-slate-900 hover:bg-slate-200"
                  }`}
                >
                  {k === "clear" ? "クリア" : k === "back" ? "← 1字消す" : k}
                </button>
              ))}
            </div>
            <button onClick={() => setPinFor(null)} className="mt-3 w-full rounded-xl border py-3 text-sm text-slate-600 hover:bg-slate-50">
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
