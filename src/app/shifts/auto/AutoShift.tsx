"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DraftShift, Need } from "@/lib/shiftDraft";
import { formatYen } from "@/lib/format";

type Staff = { staffId: string; name: string; hourlyWage: number; weeklyDays: number; submitted: number; availableDays: number; draftDays: number; totalDays: number; draftHours: number; draftPay: number };
type Data = {
  month: string;
  needs: Need[];
  includeUnsubmitted: boolean;
  draft: DraftShift[];
  shortages: { date: string; weekday: string; need: number; have: number }[];
  perStaff: Staff[];
  laborCost: number;
  existingPay: number;
  draftPay: number;
  revenue: number;
  ratio: number | null;
  notes: string[];
  existingCount: number;
  summary?: string;
  points?: string[];
  mode?: "claude" | "template";
};

const WEEKDAYS = "日月火水木金土";
// 表示は月曜はじまり
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function AutoShift({ initialMonth, ai }: { initialMonth: string | null; ai: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [needs, setNeeds] = useState<Need[] | null>(null);
  const [includeUnsubmitted, setIncludeUnsubmitted] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/shift-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "処理できませんでした");
      return json;
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "処理できませんでした" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function load(month: string | null) {
    const res = await fetch(`/api/shift-draft${month ? `?month=${month}` : ""}`);
    const json = await res.json();
    if (!res.ok) {
      setMessage({ ok: false, text: json.error || "読み込めませんでした" });
      return;
    }
    setData(json);
    setNeeds(json.needs);
    setUnchecked(new Set());
  }

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(initialMonth);
  }, [initialMonth]);

  async function run(action: "draft" | "review", month = data!.month) {
    const json = await call({ action, month, needs, includeUnsubmitted });
    if (json) {
      setData(json);
      setUnchecked(new Set());
    }
  }

  async function create() {
    if (!data) return;
    const items = data.draft.filter((d) => !unchecked.has(d.staffId + d.date)).map(({ staffId, date, start, end }) => ({ staffId, date, start, end }));
    if (!items.length || !confirm(`${items.length}件のシフトを作りますか?(Clerkly従業員用に通知されます)`)) return;
    const json = await call({ action: "create", month: data.month, items });
    if (json) {
      setMessage({ ok: true, text: `${json.created}件のシフトを作りました${json.skipped ? `(すでにシフトがある・休みの希望の${json.skipped}件は作りませんでした)` : ""}` });
      await run("draft");
    }
  }

  if (!data || !needs) return message ? <p className="text-sm text-rose-700">{message.text}</p> : null;
  const m = Number(data.month.slice(5));
  const byDate = new Map<string, DraftShift[]>();
  for (const d of data.draft) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  const selected = data.draft.filter((d) => !unchecked.has(d.staffId + d.date)).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/shifts/requests?month=${data.month}`} className="text-sm text-indigo-700 hover:underline">
          ← シフト希望
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">シフトの自動作成</h1>
        <p className="mt-1 text-sm text-slate-600">
          曜日ごとに必要な人数と時間帯を決めると、スタッフのシフト希望(出られる日・時間・休み)から1か月分のシフトの下書きを作ります。休みの希望の日には入れず、週の勤務日数はスタッフの「週の所定労働日数」まで、入った日数が少ない人・時給の低い人から入れます。すでにあるシフトは人数に数えてそのまま残します。下書きを確かめて「このシフトで作る」を押すと、シフトになります。
        </p>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <div className="flex items-center gap-2">
        <button onClick={() => run("draft", shiftMonth(data.month, -1))} disabled={busy} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
          ← 前の月
        </button>
        <span className="font-semibold">
          {data.month.slice(0, 4)}年{m}月
        </span>
        <button onClick={() => run("draft", shiftMonth(data.month, 1))} disabled={busy} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
          次の月 →
        </button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">曜日ごとに必要な人数と時間帯</h2>
        <p className="text-xs text-slate-500">はじめは直近4週のシフトから出しています。希望に時間がある人は、その時間で入れます。</p>
        <div className="mt-3 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th />
                {ORDER.map((wd) => (
                  <th key={wd} className={`px-1 pb-1 text-center font-medium ${wd === 0 ? "text-rose-600" : wd === 6 ? "text-sky-700" : ""}`}>
                    {WEEKDAYS[wd]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["count", "人数"],
                  ["start", "開始"],
                  ["end", "終了"],
                ] as const
              ).map(([field, label]) => (
                <tr key={field}>
                  <th className="pr-2 text-left text-xs font-normal whitespace-nowrap text-slate-500">{label}</th>
                  {ORDER.map((wd) => (
                    <td key={wd} className="px-1 py-0.5">
                      {field === "count" ? (
                        <input
                          type="number"
                          min={0}
                          max={50}
                          aria-label={`${WEEKDAYS[wd]}曜日の人数`}
                          value={needs[wd].count}
                          onChange={(e) => setNeeds(needs.map((n, i) => (i === wd ? { ...n, count: Math.max(0, Number(e.target.value)) } : n)))}
                          className="w-[7.5rem] rounded border px-2 py-1 text-right"
                        />
                      ) : (
                        <input
                          type="time"
                          aria-label={`${WEEKDAYS[wd]}曜日の${label}`}
                          value={needs[wd][field]}
                          disabled={needs[wd].count === 0}
                          onChange={(e) => setNeeds(needs.map((n, i) => (i === wd ? { ...n, [field]: e.target.value } : n)))}
                          className="w-[7.5rem] rounded border px-2 py-1 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-sm text-slate-700">
            <input type="checkbox" checked={includeUnsubmitted} onChange={(e) => setIncludeUnsubmitted(e.target.checked)} />
            希望を出していない日にも入れる(足りないときだけ)
          </label>
          <button onClick={() => run("draft")} disabled={busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            下書きを作り直す
          </button>
          {ai && (
            <button onClick={() => run("review")} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy ? "作っています…" : "AIの見立てを聞く"}
            </button>
          )}
        </div>
      </section>

      {data.summary && (
        <div className={`rounded-lg px-4 py-3 text-sm ${data.mode === "claude" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}>
          <p>{data.summary}</p>
          {!!data.points?.length && (
            <ul className="mt-1 list-disc pl-5">
              {data.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">下書きのシフト</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{data.draft.length}件</div>
          <div className="text-xs text-slate-500">すでにあるシフト {data.existingCount}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">人が足りない日</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${data.shortages.length ? "text-rose-700" : ""}`}>{data.shortages.length}日</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{m}月の人件費の見込み</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(data.laborCost)}</div>
          {data.ratio !== null && <div className="text-xs text-slate-500">直近3か月の売上の平均の {Math.round(data.ratio * 100)}%</div>}
        </div>
      </div>

      {data.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">スタッフごと</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">スタッフ</th>
                <th className="px-3 py-2 text-right">出られる日</th>
                <th className="px-3 py-2 text-right">下書き</th>
                <th className="px-3 py-2 text-right">月の合計</th>
                <th className="px-3 py-2 text-right">下書きの時間</th>
                <th className="px-3 py-2 text-right">下書きの給与</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.perStaff.map((s) => (
                <tr key={s.staffId}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {s.name}
                    <span className="block text-xs text-slate-500">
                      時給{formatYen(s.hourlyWage)}・週{s.weeklyDays}日まで{s.submitted ? "" : "・希望なし"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.availableDays}日</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.draftDays}日</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.totalDays}日</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.draftHours}時間</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(s.draftPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">下書き(日ごと)</h2>
          <span className="text-xs text-slate-500">チェックを外したものは作りません</span>
          <button onClick={create} disabled={busy || selected === 0} className="ml-auto rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-vermilion-700 disabled:opacity-50">
            このシフトで作る({selected}件)
          </button>
        </div>
        <ul className="divide-y text-sm">
          {[...new Set([...byDate.keys(), ...data.shortages.map((s) => s.date)])].sort().map((date) => {
            const short = data.shortages.find((s) => s.date === date);
            const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
            return (
              <li key={date} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2">
                <span className={`w-16 shrink-0 font-medium ${wd === 0 ? "text-rose-600" : wd === 6 ? "text-sky-700" : ""}`}>
                  {Number(date.slice(5, 7))}/{Number(date.slice(8))}({WEEKDAYS[wd]})
                </span>
                <span className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
                  {(byDate.get(date) ?? []).map((d) => {
                    const k = d.staffId + d.date;
                    return (
                      <label key={k} className="flex items-center gap-1 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={!unchecked.has(k)}
                          onChange={(e) => {
                            const next = new Set(unchecked);
                            if (e.target.checked) next.delete(k);
                            else next.add(k);
                            setUnchecked(next);
                          }}
                        />
                        {d.name} {d.start}〜{d.end}
                        {!d.requested && <span className="text-xs text-amber-700">(希望なし)</span>}
                      </label>
                    );
                  })}
                  {short && <span className="rounded bg-rose-50 px-2 text-xs leading-6 text-rose-700">あと{short.need - short.have}人足りません</span>}
                </span>
              </li>
            );
          })}
          {data.draft.length === 0 && data.shortages.length === 0 && <li className="px-4 py-6 text-center text-slate-400">新しく入れるシフトはありません。</li>}
        </ul>
      </section>
    </div>
  );
}
