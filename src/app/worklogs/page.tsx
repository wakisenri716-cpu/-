"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatDuration, shiftMonth, weekday } from "@/lib/workLogFormat";

type Log = { id: string; date: string; projectId: string | null; projectName: string | null; minutes: number; task: string | null };
type Data = {
  month: string;
  today: string;
  canManage: boolean;
  projects: { id: string; name: string; customerName: string | null }[];
  logs: Log[];
  totalMinutes: number;
  byProject: { name: string; minutes: number }[];
};

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export default function WorkLogsPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Log | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/worklogs${month ? `?month=${month}` : ""}`);
    if (res.ok) setData(await res.json());
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(editing ? `/api/worklogs/${editing.id}` : "/api/worklogs", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "記録できませんでした");
      return;
    }
    setMessage(editing ? "日報を直しました" : `${formatDuration(json.minutes)}を記録しました`);
    // 続けて入力しやすいよう、日付と案件は残して時間と作業内容だけ空にする
    if (editing) setEditing(null);
    else {
      (form.elements.namedItem("hours") as HTMLInputElement).value = "";
      (form.elements.namedItem("task") as HTMLInputElement).value = "";
    }
    // 記録した日の月を表示する
    const saved = String(body.date).slice(0, 7);
    if (data && saved !== data.month) setMonth(saved);
    else await load();
  }

  async function remove(log: Log) {
    if (!confirm(`${log.date} の ${formatDuration(log.minutes)}を削除しますか?`)) return;
    const res = await fetch(`/api/worklogs/${log.id}`, { method: "DELETE" });
    if (res.ok) {
      setMessage("日報を削除しました");
      if (editing?.id === log.id) setEditing(null);
      await load();
    } else setError((await res.json().catch(() => ({}))).error || "削除できませんでした");
  }

  function edit(log: Log) {
    setEditing(log);
    setMessage(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const days = data ? [...new Set(data.logs.map((l) => l.date))] : [];
  const max = Math.max(1, ...(data?.byProject.map((p) => p.minutes) ?? [1]));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">日報(工数)</h1>
          <p className="mt-1 text-sm text-slate-600">その日にどの案件の作業を何時間したかを記録します。案件ごとの人件費(工数 × 時間単価)の目安になります。</p>
        </div>
        {data?.canManage && (
          <Link href="/worklogs/summary" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            会社全体の集計 →
          </Link>
        )}
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && (
        <form
          ref={formRef}
          key={editing?.id ?? "new"}
          onSubmit={submit}
          className={`scroll-mt-4 space-y-3 rounded-xl border bg-white p-5 shadow-sm ${editing ? "border-indigo-300" : "border-slate-200"}`}
        >
          <h2 className="font-semibold">{editing ? "日報を直す" : "作業を記録する"}</h2>
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr_7rem]">
            <label className="block text-sm">
              <span className="text-slate-600">日付</span>
              <input name="date" type="date" required defaultValue={editing?.date ?? data.today} max={data.today} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">案件</span>
              <select name="projectId" defaultValue={editing?.projectId ?? data.projects[0]?.id ?? ""} className={inputClass}>
                {editing?.projectId && !data.projects.some((p) => p.id === editing.projectId) && <option value={editing.projectId}>{editing.projectName}(完了)</option>}
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.customerName ? `(${p.customerName})` : ""}
                  </option>
                ))}
                <option value="">社内の作業(会議・事務など)</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">時間</span>
              <input name="hours" required inputMode="decimal" defaultValue={editing ? hm(editing.minutes) : ""} placeholder="1.5 / 1:30" className={inputClass} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">作業内容(任意)</span>
            <input name="task" maxLength={200} defaultValue={editing?.task ?? ""} placeholder="例: トップページのデザイン" className={inputClass} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">時間は「1.5」(1時間30分)か「1:30」の形で入れます。</p>
            <div className="flex gap-2">
              {editing && (
                <button type="button" onClick={() => setEditing(null)} className="rounded-md border px-4 py-2 text-sm">
                  やめる
                </button>
              )}
              <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                {busy ? "記録中..." : editing ? "保存" : "記録する"}
              </button>
            </div>
          </div>
          {data.projects.length === 0 && <p className="text-xs text-amber-700">進行中の案件がありません。案件は管理者が「案件別損益」で登録します。</p>}
        </form>
      )}

      {data && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setMonth(shiftMonth(data.month, -1))} className="rounded-md border px-3 py-1 text-sm whitespace-nowrap hover:bg-slate-50">
              ← 前月
            </button>
            <h2 className="text-center font-semibold">
              {Number(data.month.slice(0, 4))}年{Number(data.month.slice(5))}月
              <span className="block text-sm font-normal text-slate-600">合計 {formatDuration(data.totalMinutes)}</span>
            </h2>
            <button
              onClick={() => setMonth(shiftMonth(data.month, 1))}
              disabled={data.month >= data.today.slice(0, 7)}
              className="rounded-md border px-3 py-1 text-sm whitespace-nowrap hover:bg-slate-50 disabled:opacity-40"
            >
              翌月 →
            </button>
          </div>

          {data.byProject.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {data.byProject.map((p) => (
                <li key={p.name} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_5.5rem]">
                  <span className="truncate">{p.name}</span>
                  <span className="hidden h-2 rounded-full bg-slate-100 sm:block">
                    <span className="block h-2 rounded-full bg-indigo-500" style={{ width: `${(p.minutes / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{formatDuration(p.minutes)}</span>
                </li>
              ))}
            </ul>
          )}

          {days.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">この月の日報はまだありません</p>
          ) : (
            <div className="space-y-3">
              {days.map((day) => {
                const logs = data.logs.filter((l) => l.date === day);
                return (
                  <div key={day}>
                    <p className="flex justify-between border-b pb-1 text-sm font-medium">
                      <span>
                        {Number(day.slice(5, 7))}/{Number(day.slice(8))}({weekday(day)})
                      </span>
                      <span className="tabular-nums text-slate-600">{formatDuration(logs.reduce((s, l) => s + l.minutes, 0))}</span>
                    </p>
                    <ul className="divide-y divide-slate-100 text-sm">
                      {logs.map((l) => (
                        <li key={l.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 ${editing?.id === l.id ? "bg-indigo-50" : ""}`}>
                          <span className="min-w-0 flex-1">
                            <span className={l.projectName ? "" : "text-slate-500"}>{l.projectName ?? "社内の作業"}</span>
                            {l.task && <span className="block text-xs text-slate-500">{l.task}</span>}
                          </span>
                          <span className="tabular-nums">{formatDuration(l.minutes)}</span>
                          <span className="flex gap-2 text-xs">
                            <button onClick={() => edit(l)} className="text-indigo-700 hover:underline">
                              直す
                            </button>
                            <button onClick={() => remove(l)} className="text-slate-500 hover:text-rose-700 hover:underline">
                              削除
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
