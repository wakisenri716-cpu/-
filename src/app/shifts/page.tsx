"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";
import { dailyPay, formatClock, formatMinutes, parseTime } from "@/lib/shifts/pay";

type Pay = { workMinutes: number; nightMinutes: number; overtimeMinutes: number; base: number; night: number; overtime: number; total: number };
type Staff = { id: string; name: string; hourlyWage: number; active: boolean; week: Pay };
type Shift = { id: string; staffId: string; date: string; startMinutes: number; endMinutes: number; breakMinutes: number; note: string | null };
type Week = { weekStart: string; days: string[]; staff: Staff[]; shifts: Shift[]; daily: (Pay & { date: string; people: number })[] };
type PayrollRow = Pay & { staffId: string; name: string; hourlyWage: number };
type Payroll = { month: string; rows: PayrollRow[]; total: number; run: { totalAmount: number; createdAt: string } | null };

type Draft = { id?: string; staffId: string; date: string; start: string; end: string; breakMinutes: number; note: string };

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
const CHIP_COLORS = [
  "bg-indigo-50 text-indigo-800 border-indigo-200",
  "bg-emerald-50 text-emerald-800 border-emerald-200",
  "bg-amber-50 text-amber-800 border-amber-200",
  "bg-rose-50 text-rose-800 border-rose-200",
  "bg-sky-50 text-sky-800 border-sky-200",
  "bg-violet-50 text-violet-800 border-violet-200",
];
const BREAK_OPTIONS = [0, 15, 30, 45, 60, 90, 120];

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

function hours(minutes: number) {
  return `${formatMinutes(minutes)}h`;
}

function toTimeInput(minutes: number) {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const inputClass = "w-full rounded-md border px-2.5 py-1.5 text-sm";

export default function ShiftsPage() {
  const [weekKey, setWeekKey] = useState(todayKey());
  const [week, setWeek] = useState<Week | null>(null);
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [allStaff, setAllStaff] = useState<Omit<Staff, "week">[]>([]);
  const [wages, setWages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWeek = useCallback(async () => {
    const res = await fetch(`/api/shifts?week=${weekKey}`);
    setWeek(await res.json());
  }, [weekKey]);

  const loadStaff = useCallback(async () => {
    const res = await fetch("/api/staff");
    setAllStaff(await res.json());
  }, []);

  const loadPayroll = useCallback(async () => {
    const res = await fetch(`/api/payroll?month=${month}`);
    setPayroll(await res.json());
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount/week change: the resulting setState always lands after
    // the fetch's await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    // Same fetch-on-change pattern as above, for the monthly payroll panel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPayroll();
  }, [loadPayroll]);

  useEffect(() => {
    // Same fetch-on-mount pattern, for the staff list (includes retired staff).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStaff();
  }, [loadStaff]);

  async function call(url: string, init: RequestInit, success?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "処理に失敗しました");
      if (success) setMessage(success);
      await Promise.all([loadWeek(), loadPayroll(), loadStaff()]);
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const body = JSON.stringify(draft);
    const ok = draft.id
      ? await call(`/api/shifts/${draft.id}`, { method: "PUT", body })
      : await call("/api/shifts", { method: "POST", body });
    if (ok) setDraft(null);
  }

  async function deleteDraft() {
    if (!draft?.id) return;
    if (await call(`/api/shifts/${draft.id}`, { method: "DELETE" })) setDraft(null);
  }

  async function copyWeek() {
    const result = await call("/api/shifts/copy", { method: "POST", body: JSON.stringify({ week: week?.weekStart }) });
    if (result) {
      setMessage(
        result.copied > 0
          ? `先週のシフトを${result.copied}件コピーしました${result.skipped ? `(すでにシフトがある${result.skipped}件は飛ばしました)` : ""}`
          : "コピーできる先週のシフトがありませんでした",
      );
    }
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (await call("/api/staff", { method: "POST", body: JSON.stringify(data) }, `${data.name}さんを登録しました`)) form.reset();
  }

  const staff = week?.staff ?? [];
  const colorOf = (staffId: string) => CHIP_COLORS[Math.max(0, staff.findIndex((s) => s.id === staffId)) % CHIP_COLORS.length];
  const weekTotal = week?.daily.reduce((sum, d) => sum + d.total, 0) ?? 0;
  const weekMinutes = week?.daily.reduce((sum, d) => sum + d.workMinutes, 0) ?? 0;

  const preview = (() => {
    if (!draft) return null;
    const start = parseTime(draft.start);
    let end = parseTime(draft.end);
    const person = staff.find((s) => s.id === draft.staffId);
    if (start === null || end === null || !person) return null;
    if (end <= start) end += 1440;
    const pay = dailyPay([{ startMinutes: start, endMinutes: end, breakMinutes: draft.breakMinutes }], person.hourlyWage);
    return { ...pay, total: Math.round(pay.base + pay.night + pay.overtime), overnight: end > 1440 };
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">シフト管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          スタッフのシフトを週ごとに組むと、勤務時間と人件費(深夜22時〜5時・1日8時間超の25%割増を含む)を自動で計算します。
          月末には「給料手当 / 未払金」として帳簿に計上できます。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <button
          onClick={copyWeek}
          disabled={busy || staff.length === 0}
          className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          先週のシフトをコピー
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-32 px-3 py-2 text-left">スタッフ</th>
                {week?.days.map((d, i) => (
                  <th key={d} className={`px-1 py-2 font-medium ${i === 5 ? "text-sky-700" : i === 6 ? "text-rose-600" : ""} ${d === todayKey() ? "bg-indigo-50" : ""}`}>
                    {shortDate(d)}({WEEKDAYS[i]})
                  </th>
                ))}
                <th className="w-28 px-3 py-2 text-right">週の合計</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {staff.map((person) => (
                <tr key={person.id} className="align-top hover:bg-transparent">
                  <td className="px-3 py-2">
                    <div className={`font-medium ${person.active ? "" : "text-slate-400"}`}>{person.name}</div>
                    <div className="text-xs text-slate-500">時給 {formatYen(person.hourlyWage)}</div>
                  </td>
                  {week?.days.map((d) => {
                    const cellShifts = week.shifts.filter((s) => s.staffId === person.id && s.date === d);
                    return (
                      <td key={d} className={`px-1 py-1.5 ${d === todayKey() ? "bg-indigo-50/40" : ""}`}>
                        <div className="space-y-1">
                          {cellShifts.map((s) => (
                            <button
                              key={s.id}
                              onClick={() =>
                                setDraft({
                                  id: s.id,
                                  staffId: s.staffId,
                                  date: s.date,
                                  start: toTimeInput(s.startMinutes),
                                  end: toTimeInput(s.endMinutes),
                                  breakMinutes: s.breakMinutes,
                                  note: s.note ?? "",
                                })
                              }
                              className={`block w-full rounded-md border px-1.5 py-1 text-left text-xs leading-tight hover:shadow-sm ${colorOf(person.id)}`}
                            >
                              <span className="font-medium whitespace-nowrap">
                                {formatClock(s.startMinutes)}-{formatClock(s.endMinutes)}
                              </span>
                              {s.breakMinutes > 0 && <span className="block text-[11px] opacity-70">休憩{s.breakMinutes}分</span>}
                            </button>
                          ))}
                          {person.active && (
                            <button
                              onClick={() => setDraft({ staffId: person.id, date: d, start: "09:00", end: "17:00", breakMinutes: 60, note: "" })}
                              className="block w-full rounded-md border border-dashed border-slate-200 py-0.5 text-xs text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
                              aria-label={`${person.name}さん ${d} のシフトを追加`}
                            >
                              +
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                    <div className="font-medium text-slate-900">{hours(person.week.workMinutes)}</div>
                    <div className="text-slate-500">{formatYen(person.week.total)}</div>
                  </td>
                </tr>
              ))}
              {week && staff.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    まずは下の「スタッフを登録」から、名前と時給を登録してください。
                  </td>
                </tr>
              )}
            </tbody>
            {staff.length > 0 && (
              <tfoot className="border-t bg-slate-50 text-xs">
                <tr>
                  <td className="px-3 py-2 font-medium">1日の合計</td>
                  {week?.daily.map((d) => (
                    <td key={d.date} className="px-1 py-2 text-center">
                      <div className="font-medium text-slate-900">{d.people}人・{hours(d.workMinutes)}</div>
                      <div className="text-slate-500">{formatYen(d.total)}</div>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{hours(weekMinutes)}</div>
                    <div className="font-semibold text-slate-900">{formatYen(weekTotal)}</div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" onClick={() => setDraft(null)}>
          <form
            onSubmit={saveDraft}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 className="font-semibold">
              {staff.find((s) => s.id === draft.staffId)?.name}さん・{shortDate(draft.date)}
              {draft.id ? " のシフトを編集" : " のシフトを追加"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">開始</label>
                <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">終了</label>
                <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} required className={inputClass} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">休憩</label>
              <select
                value={draft.breakMinutes}
                onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) })}
                className={inputClass}
              >
                {BREAK_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "なし" : `${m}分`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">メモ(任意)</label>
              <input type="text" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={inputClass} />
            </div>
            {preview && (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {preview.overnight && "日付をまたぐ勤務です。"}実働 {hours(preview.workMinutes)}
                {preview.nightMinutes > 0 && `(深夜 ${hours(preview.nightMinutes)})`}
                {preview.overtimeMinutes > 0 && `(残業 ${hours(preview.overtimeMinutes)})`} ・ 見込み {formatYen(preview.total)}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              {draft.id ? (
                <button type="button" onClick={deleteDraft} disabled={busy} className="text-sm text-rose-600 hover:underline disabled:opacity-50">
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

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">月の人件費と給料の計上</h2>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border px-2 py-1 text-sm" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs whitespace-nowrap text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">スタッフ</th>
                  <th className="py-1 pr-2 text-right font-medium">勤務時間</th>
                  <th className="py-1 pr-2 text-right font-medium">基本</th>
                  <th className="py-1 pr-2 text-right font-medium">深夜割増</th>
                  <th className="py-1 pr-2 text-right font-medium">残業割増</th>
                  <th className="py-1 text-right font-medium">合計</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payroll?.rows.map((r) => (
                  <tr key={r.staffId}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{r.name}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">{hours(r.workMinutes)}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">{formatYen(r.base)}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">{r.night ? formatYen(r.night) : "-"}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">{r.overtime ? formatYen(r.overtime) : "-"}</td>
                    <td className="py-1.5 text-right font-medium whitespace-nowrap">{formatYen(r.total)}</td>
                  </tr>
                ))}
                {payroll && payroll.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400">
                      この月のシフトはまだありません。
                    </td>
                  </tr>
                )}
              </tbody>
              {payroll && payroll.rows.length > 0 && (
                <tfoot className="border-t font-semibold">
                  <tr>
                    <td className="pt-2" colSpan={5}>
                      総支給額(見込み)
                    </td>
                    <td className="pt-2 text-right whitespace-nowrap">{formatYen(payroll.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {payroll?.run ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span>
                {formatYen(payroll.run.totalAmount)} を給料として計上済みです
                {payroll.run.totalAmount !== payroll.total && "(計上後にシフトが変わっています。取り消して計上し直してください)"}
              </span>
              <button
                onClick={() => call(`/api/payroll?month=${month}`, { method: "DELETE" }, "計上を取り消しました")}
                disabled={busy}
                className="text-xs text-rose-600 hover:underline disabled:opacity-50"
              >
                取り消す
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                総支給額を「給料手当 / 未払金」で計上します。振込を銀行明細から取り込むと、未払金の支払いとして判定されます。
                源泉所得税・社会保険料などの控除は含みません。
              </p>
              <button
                onClick={() => call("/api/payroll", { method: "POST", body: JSON.stringify({ month }) }, "給料を計上しました")}
                disabled={busy || !payroll || payroll.total === 0}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                給料として計上
              </button>
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="font-semibold">スタッフ</h2>
          <form onSubmit={addStaff} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[8rem] flex-1">
              <label className="mb-1 block text-xs text-slate-500">名前</label>
              <input type="text" name="name" required className={inputClass} />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs text-slate-500">時給(円)</label>
              <input type="number" name="hourlyWage" min={1} step={1} required className={inputClass} />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              登録
            </button>
          </form>
          <ul className="divide-y">
            {allStaff.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className={`flex-1 ${person.active ? "" : "text-slate-400 line-through"}`}>{person.name}</span>
                <input
                  type="number"
                  min={1}
                  value={wages[person.id] ?? String(person.hourlyWage)}
                  onChange={(e) => setWages((prev) => ({ ...prev, [person.id]: e.target.value }))}
                  className="w-24 rounded-md border px-2 py-1 text-right text-sm"
                  aria-label={`${person.name}さんの時給`}
                />
                {wages[person.id] !== undefined && Number(wages[person.id]) !== person.hourlyWage && (
                  <button
                    onClick={async () => {
                      const ok = await call(
                        `/api/staff/${person.id}`,
                        { method: "PATCH", body: JSON.stringify({ hourlyWage: Number(wages[person.id]) }) },
                        `${person.name}さんの時給を変更しました`,
                      );
                      if (ok) {
                        setWages((prev) => {
                          const next = { ...prev };
                          delete next[person.id];
                          return next;
                        });
                      }
                    }}
                    className="text-xs text-indigo-700 hover:underline"
                  >
                    保存
                  </button>
                )}
                <button
                  onClick={() => call(`/api/staff/${person.id}`, { method: "PATCH", body: JSON.stringify({ active: !person.active }) })}
                  className="text-xs text-slate-500 hover:underline"
                >
                  {person.active ? "退職にする" : "在籍に戻す"}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">時給を変えると、まだ計上していない月の人件費は新しい時給で計算し直されます。</p>
        </section>
      </div>
    </div>
  );
}
