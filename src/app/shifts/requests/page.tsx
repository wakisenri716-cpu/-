"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Cell = { date: string; request: { available: boolean; start: string | null; end: string | null; note: string | null } | null; shifts: { start: string; end: string }[] };
type StaffRow = { id: string; name: string; linked: boolean; submitted: number; available: number; off: number; cells: Cell[] };
type Data = { month: string; deadlineDay: number | null; deadline: string | null; days: { date: string; weekday: string }[]; staff: StaffRow[] };

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const dayColor = (w: string) => (w === "日" ? "text-rose-600" : w === "土" ? "text-sky-600" : "text-slate-500");

export default function ShiftRequestsPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shift-requests${month ? `?month=${month}` : ""}`);
    if (res.ok) setData(await res.json());
  }, [month]);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(body: object, done: (j: Record<string, number | null>) => string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/shift-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? { ok: true, text: done(json) } : { ok: false, text: json.error || "処理できませんでした" });
    await load();
  }

  if (!data) return null;
  const m = Number(data.month.slice(5));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/shifts" className="text-sm text-indigo-700 hover:underline">
            ← シフト管理
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">シフト希望</h1>
          <p className="mt-1 text-sm text-slate-600">
            スタッフがスタッフアプリ(スマホ)から出した「出られる日・時間」と「休みたい日」を一覧にします。「希望からシフトを作る」で、時間のある希望をそのままシフトにできます(すでにシフトがある日は作りません)。
          </p>
        </div>
      </div>

      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(shiftMonth(data.month, -1))} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            ← 前の月
          </button>
          <span className="font-semibold">
            {data.month.slice(0, 4)}年{m}月
          </span>
          <button onClick={() => setMonth(shiftMonth(data.month, 1))} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            次の月 →
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-slate-600">
            提出の締め切り: 前月
            <select value={data.deadlineDay ?? ""} onChange={(e) => post({ action: "deadline", day: e.target.value }, (j) => (j.day ? `締め切りを前月${j.day}日にしました` : "締め切りをなしにしました"))} className="rounded border px-2 py-1">
              <option value="">なし</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}日
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => confirm(`${m}月の希望(時間のあるもの)から、シフトを作りますか?`) && post({ action: "apply", month: data.month }, (j) => `${j.created}件のシフトを作りました${j.skipped ? `(すでにシフトがある${j.skipped}件は作りませんでした)` : ""}`)}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            希望からシフトを作る
          </button>
          <Link href={`/shifts/auto?month=${data.month}`} className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-100">
            人数を決めて自動で作る
          </Link>
        </div>
      </div>
      {data.deadline && <p className="text-sm text-slate-600">{m}月分の締め切り: {data.deadline.replaceAll("-", "/")}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 min-w-28 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">スタッフ</th>
                {data.days.map((d) => (
                  <th key={d.date} className={`min-w-14 px-1 py-2 text-center font-medium ${dayColor(d.weekday)}`}>
                    {Number(d.date.slice(8))}
                    <span className="block text-[10px]">{d.weekday}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.staff.map((s) => (
                <tr key={s.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2">
                    <span className="block font-medium whitespace-nowrap">{s.name}</span>
                    <span className="text-[11px] text-slate-500">{s.linked ? (s.submitted ? `◯${s.available} ✕${s.off}` : "未提出") : "アカウント未ひも付け"}</span>
                  </td>
                  {s.cells.map((c) => (
                    <td key={c.date} className="px-1 py-1.5 text-center align-top" title={c.request?.note ?? undefined}>
                      {c.shifts.length > 0 ? (
                        <span className="block rounded bg-indigo-600 px-1 py-0.5 text-[10px] leading-tight text-white">
                          {c.shifts[0].start}
                          <br />
                          {c.shifts[0].end}
                        </span>
                      ) : c.request ? (
                        c.request.available ? (
                          <span className="block rounded bg-emerald-50 px-1 py-0.5 text-[10px] leading-tight text-emerald-800">
                            {c.request.start ? (
                              <>
                                {c.request.start}
                                <br />
                                {c.request.end}
                              </>
                            ) : (
                              "◯"
                            )}
                          </span>
                        ) : (
                          <span className="block rounded bg-rose-50 px-1 py-0.5 text-rose-700">✕</span>
                        )
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                      {c.request?.note && <span className="block text-[10px] text-amber-600">💬</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {data.staff.length === 0 && (
                <tr>
                  <td colSpan={data.days.length + 1} className="px-3 py-8 text-center text-sm text-slate-400">
                    スタッフがいません。「シフト管理」でスタッフを登録してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        見方: <span className="rounded bg-indigo-600 px-1 text-white">青</span> 決まったシフト / <span className="rounded bg-emerald-50 px-1 text-emerald-800">緑</span> 出られる(時間がなければ何時でも可) / <span className="rounded bg-rose-50 px-1 text-rose-700">✕</span> 休みたい / 💬 ひとことあり(マウスを乗せると表示)。スタッフがアプリで希望を出すには、「シフト管理」のスタッフをログインのアカウントにひも付けてください。作ったシフトの休憩は、6時間超で45分・8時間超で60分にしています。
      </p>
    </div>
  );
}
