"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

type Flag = { level: "danger" | "warn"; message: string };
type OvertimeRow = {
  id: string;
  name: string;
  months: { month: string; minutes: number; forecast: boolean }[];
  thisMonth: number;
  yearToDate: number;
  yearTotal: number;
  overCount: number;
  flags: Flag[];
};
type Overtime = {
  settings: { startMonth: number; monthlyLimit: number; yearlyLimit: number };
  selected: string;
  current: string;
  months: string[];
  rows: OvertimeRow[];
};
type LeaveStaff = {
  id: string;
  name: string;
  hireDate: string | null;
  weeklyDays: number;
  scheduledMinutes: number;
  hourlyWage: number;
  balance: number;
  expiring: { halfDays: number; expires: string }[];
  next: { date: string; halfDays: number } | null;
  obligations: { grantDate: string; deadline: string; used: number; required: number; met: boolean; ended: boolean }[];
  grants: { id: string; grantDate: string; halfDays: number; remaining: number; expires: string; expired: boolean; auto: boolean; note: string | null }[];
  taken: { id: string; date: string; halfDays: number; bulk: boolean; note: string | null; short: number }[];
};
type Leave = { today: string; staff: LeaveStaff[] };

const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const d = (halfDays: number) => `${halfDays % 2 === 0 ? halfDays / 2 : (halfDays / 2).toFixed(1)}日`;
const slash = (key: string) => key.replaceAll("-", "/");
const inputClass = "rounded-md border px-2.5 py-1.5 text-sm";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function LeavePage() {
  const [tab, setTab] = useState<"overtime" | "leave">("overtime");
  const [month, setMonth] = useState(currentMonth);
  const [overtime, setOvertime] = useState<Overtime | null>(null);
  const [leave, setLeave] = useState<Leave | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [o, l] = await Promise.all([fetch(`/api/overtime?month=${month}`), fetch("/api/leave")]);
    if (o.ok) setOvertime(await o.json());
    if (l.ok) setLeave(await l.json());
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount/month change: the resulting setState always lands after the fetch's
    // await, so the extra render this rule warns about never happens here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存できませんでした");
      setMessage(done);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const alerts = overtime?.rows.filter((r) => r.flags.length) ?? [];
  const leaveAlerts = leave?.staff.filter((s) => s.obligations.some((o) => !o.met)) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">有給休暇・残業時間</h1>
          <PrintButton variant="outline" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          タイムカードとシフトから残業時間(1日8時間・週40時間を超えた分)を集計して、36協定の上限に近づいた人を知らせます。
          有給休暇は入社日から法律どおりの日数を自動で付与し、残りの日数・時効・年5日の取得義務を管理します。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      <div className="flex gap-2 border-b print:hidden">
        {(
          [
            ["overtime", `残業時間${alerts.length ? ` (注意 ${alerts.length})` : ""}`],
            ["leave", `有給休暇${leaveAlerts.length ? ` (注意 ${leaveAlerts.length})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium ${tab === key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overtime" && overtime && (
        <OvertimeView data={overtime} month={month} setMonth={setMonth} busy={busy} send={send} />
      )}
      {tab === "leave" && leave && <LeaveView data={leave} busy={busy} send={send} />}
    </div>
  );
}

type Send = (url: string, method: string, body: unknown, done: string) => Promise<boolean>;

function OvertimeView({ data, month, setMonth, busy, send }: { data: Overtime; month: string; setMonth: (m: string) => void; busy: boolean; send: Send }) {
  const limit = data.settings.monthlyLimit * 60;
  const cellClass = (minutes: number) =>
    minutes > limit ? "bg-rose-100 font-semibold text-rose-800" : minutes >= limit * 0.8 ? "bg-amber-100 text-amber-900" : minutes > 0 ? "" : "text-slate-300";

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    send("/api/overtime", "PATCH", { startMonth: f.get("startMonth"), monthlyLimit: f.get("monthlyLimit"), yearlyLimit: f.get("yearlyLimit") }, "36協定の設定を保存しました");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">見る月</span>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={inputClass} />
        </label>
        <div className="text-sm text-slate-600">
          36協定: {data.settings.startMonth}月起算 ・ 月{data.settings.monthlyLimit}時間 ・ 年{data.settings.yearlyLimit}時間
        </div>
      </div>

      {data.rows.some((r) => r.flags.length) ? (
        <div className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <div className="font-semibold text-rose-800">上限に近い・超えている人がいます</div>
          {data.rows.flatMap((r) =>
            r.flags.map((f, i) => (
              <div key={`${r.id}-${i}`} className={f.level === "danger" ? "text-rose-800" : "text-amber-800"}>
                {f.level === "danger" ? "● " : "▲ "}
                {r.name}さん: {f.message}
              </div>
            )),
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">上限に近づいている人はいません。</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">スタッフ</th>
                {data.months.map((mk) => (
                  <th key={mk} className={`px-1.5 py-2 text-right font-medium ${mk === data.selected ? "bg-indigo-50 text-indigo-700" : ""}`}>
                    {Number(mk.slice(5))}月
                  </th>
                ))}
                <th className="px-3 py-2 text-right">年合計</th>
                <th className="px-3 py-2 text-right">{data.settings.monthlyLimit}h超</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                  {r.months.map((m) => (
                    <td key={m.month} className={`px-1.5 py-2 text-right tabular-nums whitespace-nowrap ${cellClass(m.minutes)} ${m.forecast && m.minutes ? "italic" : ""}`}>
                      {m.minutes ? hours(m.minutes) : "-"}
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.yearTotal > data.settings.yearlyLimit * 60 ? "text-rose-700" : ""}`}>{hours(r.yearTotal)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.overCount > 6 ? "font-semibold text-rose-700" : "text-slate-500"}`}>{r.overCount}回</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-6 text-center text-slate-400">
                    「シフト管理」でスタッフを登録すると、ここに残業時間が出ます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        時間は「時間:分」。赤は月の上限超え、黄色は上限の8割以上。今月以降の斜体はシフトの予定からの見込みです。
        時間外は給与計算の割増と同じく「1日8時間を超えた分」と「週(月〜日)40時間を超えた分」で、法定休日の労働は区別していません。
      </p>

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm print:hidden">
        <summary className="cursor-pointer font-medium text-slate-700">36協定の設定</summary>
        <form key={JSON.stringify(data.settings)} onSubmit={saveSettings} className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-xs text-slate-500">起算月(協定の1年の始まり)</span>
            <select name="startMonth" defaultValue={data.settings.startMonth} className={inputClass}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}月
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">月の上限(時間)</span>
            <input name="monthlyLimit" type="number" min={1} max={99} defaultValue={data.settings.monthlyLimit} className={`${inputClass} w-24`} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">年の上限(時間)</span>
            <input name="yearlyLimit" type="number" min={1} max={720} defaultValue={data.settings.yearlyLimit} className={`${inputClass} w-24`} />
          </label>
          <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            保存
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          原則は月45時間・年360時間です。特別条項を結んでいる場合でも、単月100時間未満・2〜6か月平均80時間以内・月45時間超えは年6回までは、法律の上限として必ずチェックします。
        </p>
      </details>
    </div>
  );
}

function LeaveView({ data, busy, send }: { data: Leave; busy: boolean; send: Send }) {
  return (
    <div className="space-y-4">
      {data.staff.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">「シフト管理」でスタッフを登録してください。</div>
      )}
      {data.staff.map((s) => (
        <StaffLeave key={s.id} s={s} today={data.today} busy={busy} send={send} />
      ))}
      <p className="text-xs text-slate-500">
        付与日数は労働基準法のとおり(入社6か月で10日、その後1年ごとに11日・12日・14日…最大20日。週4日以下の人は比例付与)で、出勤率8割以上を満たしている前提です。
        古い付与から使い、付与から2年で時効になります。有給の日の賃金は「時給 × 1日の所定労働時間」(半日はその半分)で給与計算に入ります。
      </p>
    </div>
  );
}

function StaffLeave({ s, today, busy, send }: { s: LeaveStaff; today: string; busy: boolean; send: Send }) {
  const [kind, setKind] = useState<"FULL" | "HALF" | "BULK">("FULL");
  const open = s.obligations.filter((o) => !o.ended);
  const missed = s.obligations.filter((o) => o.ended && !o.met);

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    send(
      `/api/leave/staff/${s.id}`,
      "PATCH",
      { hireDate: f.get("hireDate") || null, weeklyDays: Number(f.get("weeklyDays")), scheduledMinutes: Math.round(Number(f.get("scheduledHours")) * 60) },
      `${s.name}さんの設定を保存しました`,
    );
  }

  async function take(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const ok = await send("/api/leave/taken", "POST", { staffId: s.id, date: f.get("date"), kind, days: f.get("days"), note: f.get("note") }, `${s.name}さんの有給を登録しました`);
    if (ok) form.reset();
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const ok = await send("/api/leave/grants", "POST", { staffId: s.id, grantDate: f.get("grantDate"), days: f.get("days"), note: f.get("note") }, `${s.name}さんに有給を付与しました`);
    if (ok) form.reset();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{s.name}</h2>
          <p className="text-xs text-slate-500">
            {s.hireDate ? `入社 ${slash(s.hireDate)}` : "入社日が未設定(自動で付与されません)"} ・ 週{s.weeklyDays}日 ・ 1日{hours(s.scheduledMinutes)} ・ 有給1日の賃金{" "}
            {formatYen(Math.round((s.hourlyWage * s.scheduledMinutes) / 60))}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">残り</div>
          <div className="text-2xl font-bold tabular-nums">{d(s.balance)}</div>
          {s.next && (
            <div className="text-xs text-slate-500">
              次の付与 {slash(s.next.date)}(+{d(s.next.halfDays)})
            </div>
          )}
        </div>
      </div>

      {open.map((o) => (
        <div key={o.grantDate} className={`rounded-lg px-3 py-2 text-sm ${o.met ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              年5日の取得義務({slash(o.grantDate)} 付与分): {d(o.used)} / 5日 {o.met ? "達成" : `・あと${d(o.required - o.used)}を ${slash(o.deadline)} までに`}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white">
            <div className={`h-full rounded-full ${o.met ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, (o.used / o.required) * 100)}%` }} />
          </div>
        </div>
      ))}
      {missed.map((o) => (
        <div key={o.grantDate} className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {slash(o.grantDate)} 付与分の年5日を期限({slash(o.deadline)})までに取れていません({d(o.used)})。取得の記録漏れがないか確かめてください。
        </div>
      ))}
      {s.expiring.map((e) => (
        <div key={e.expires} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {d(e.halfDays)}が {slash(e.expires)} で時効になります。
        </div>
      ))}

      <form onSubmit={take} className="flex flex-wrap items-end gap-2 print:hidden">
        <label>
          <span className="mb-1 block text-xs text-slate-500">有給を取った日</span>
          <input name="date" type="date" required defaultValue={today} className={inputClass} />
        </label>
        <div className="flex gap-3 pb-1.5 text-sm">
          {(
            [
              ["FULL", "1日"],
              ["HALF", "半日"],
              ["BULK", "まとめて"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1">
              <input type="radio" name={`kind-${s.id}`} checked={kind === value} onChange={() => setKind(value)} /> {label}
            </label>
          ))}
        </div>
        {kind === "BULK" && (
          <label>
            <span className="mb-1 block text-xs text-slate-500">日数(導入前に取った分)</span>
            <input name="days" type="number" min={0.5} step={0.5} required className={`${inputClass} w-24`} />
          </label>
        )}
        <label className="w-full min-w-0 sm:w-auto sm:flex-1">
          <span className="mb-1 block text-xs text-slate-500">メモ(任意)</span>
          <input name="note" maxLength={100} className={`${inputClass} w-full`} />
        </label>
        <button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          登録
        </button>
      </form>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">付与・取得の履歴と設定</summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold text-slate-500">付与</h3>
            <ul className="divide-y rounded-lg border">
              {s.grants.map((g) => (
                <li key={g.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 ${g.expired ? "text-slate-400" : ""}`}>
                  <span>
                    {slash(g.grantDate)} +{d(g.halfDays)} {g.auto ? "(自動)" : `(手動${g.note ? `: ${g.note}` : ""})`}
                  </span>
                  <span className="text-xs">
                    {g.expired ? "時効" : `残り${d(g.remaining)}・${slash(g.expires)}まで`}
                    {!g.auto && (
                      <button type="button" onClick={() => send(`/api/leave/grants/${g.id}`, "DELETE", undefined, "付与を削除しました")} className="ml-2 text-rose-600 hover:underline">
                        削除
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {s.grants.length === 0 && <li className="px-3 py-2 text-slate-400">まだ付与はありません</li>}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-slate-500">取得</h3>
            <ul className="divide-y rounded-lg border">
              {s.taken.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span>
                    {slash(t.date)} {t.bulk ? `まとめて ${d(t.halfDays)}` : t.halfDays === 1 ? "半日" : "1日"}
                    {t.note && <span className="text-slate-500"> ・{t.note}</span>}
                    {t.short > 0 && <span className="text-rose-600"> ・付与が{d(t.short)}足りません</span>}
                  </span>
                  <button type="button" onClick={() => send(`/api/leave/taken/${t.id}`, "DELETE", undefined, "取得の記録を削除しました")} className="text-xs text-rose-600 hover:underline">
                    削除
                  </button>
                </li>
              ))}
              {s.taken.length === 0 && <li className="px-3 py-2 text-slate-400">まだ取得はありません</li>}
            </ul>
          </div>
        </div>

        <form key={`${s.hireDate}-${s.weeklyDays}-${s.scheduledMinutes}`} onSubmit={saveSettings} className="mt-4 flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-xs text-slate-500">入社日</span>
            <input name="hireDate" type="date" defaultValue={s.hireDate ?? ""} className={inputClass} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">週の所定労働日数</span>
            <select name="weeklyDays" defaultValue={s.weeklyDays} className={inputClass}>
              <option value={5}>週5日以上(または週30時間以上)</option>
              <option value={4}>週4日</option>
              <option value={3}>週3日</option>
              <option value={2}>週2日</option>
              <option value={1}>週1日</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">1日の所定労働時間</span>
            <input name="scheduledHours" type="number" min={0.5} max={12} step={0.25} defaultValue={s.scheduledMinutes / 60} className={`${inputClass} w-24`} />
          </label>
          <button disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
            設定を保存
          </button>
        </form>

        <form onSubmit={grant} className="mt-3 flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-xs text-slate-500">手で付与する日</span>
            <input name="grantDate" type="date" required defaultValue={today} className={inputClass} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">日数</span>
            <input name="days" type="number" min={0.5} max={40} step={0.5} required className={`${inputClass} w-24`} />
          </label>
          <label className="w-full min-w-0 sm:w-auto sm:flex-1">
            <span className="mb-1 block text-xs text-slate-500">理由(例: 導入時点の残り)</span>
            <input name="note" maxLength={100} className={`${inputClass} w-full`} />
          </label>
          <button disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
            付与を追加
          </button>
        </form>
      </details>
    </section>
  );
}
