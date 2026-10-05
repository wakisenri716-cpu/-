"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Month = { month: string; days: number; pay: number; future: boolean };
type Row = {
  id: string;
  staffName: string;
  month: string;
  kind: string;
  before: number;
  after: number;
  months: Month[];
  average: number | null;
  current: number | null;
  currentGrade: number | null;
  next: number | null;
  nextGrade: number | null;
  pension: number | null;
  diff: number | null;
  status: "CANDIDATE" | "WAITING" | "NOT_ENOUGH_DAYS" | "NO_CHANGE" | "OPPOSITE" | "NO_STANDARD" | "NOT_INSURED" | "APPLIED";
  effectiveMonth: string;
  appliedAt: string | null;
  appliedByName: string | null;
};
type Data = { rows: Row[]; staff: { id: string; name: string; hourlyWage: number; commuteAllowance: number }[]; candidates: number };

const KIND: Record<string, string> = { WAGE: "時給", COMMUTE: "通勤手当" };
const STATUS: Record<Row["status"], { label: string; cls: string }> = {
  CANDIDATE: { label: "月額変更の対象", cls: "bg-rose-100 text-rose-800" },
  APPLIED: { label: "反映済み", cls: "bg-emerald-100 text-emerald-800" },
  WAITING: { label: "3か月たつのを待っています", cls: "bg-slate-100 text-slate-600" },
  NOT_ENOUGH_DAYS: { label: "対象外(17日未満の月あり)", cls: "bg-slate-100 text-slate-600" },
  NO_CHANGE: { label: "対象外(2等級以上の差なし)", cls: "bg-slate-100 text-slate-600" },
  OPPOSITE: { label: "対象外(賃金と等級の向きが逆)", cls: "bg-slate-100 text-slate-600" },
  NO_STANDARD: { label: "標準報酬月額が未設定", cls: "bg-amber-100 text-amber-800" },
  NOT_INSURED: { label: "社会保険に未加入", cls: "bg-slate-100 text-slate-500" },
};
const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const thousand = (n: number | null) => (n === null ? "-" : `${(n / 1000).toLocaleString("ja-JP")}千円`);

export function MonthlyChangeView() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ staffId: "", month: "", kind: "WAGE", before: "", after: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/payroll/monthly-change");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(method: "POST" | "DELETE", body: object | null, done: string, query = "") {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/payroll/monthly-change${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: json.error || "できませんでした" }), false;
    setMessage({ ok: true, text: done });
    await load();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call("POST", { action: "add", ...form }, "変動を記録しました。")) setForm({ staffId: "", month: "", kind: "WAGE", before: "", after: "" });
  }

  if (!data) return null;
  const inputClass = "mt-1 w-full rounded-md border px-2 py-1.5";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/payroll/standard" className="text-sm text-indigo-700 hover:underline">
          ← 算定基礎(標準報酬)
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">社会保険の月額変更(随時改定)</h1>
        <p className="mt-1 text-sm text-slate-600">
          時給や通勤手当などが変わった月から3か月の給与(通勤手当を含む)の平均で、今の標準報酬月額と2等級以上の差が出て、3か月とも17日以上働いていれば、4か月目から標準報酬月額を変えます(「月額変更届」を出します)。時給・通勤手当を変えると、ここに自動で記録されます。
        </p>
      </div>

      {data.candidates > 0 && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">月額変更届が必要な人が {data.candidates}人 います。速やかに届け出て、「反映する」で給与計算の標準報酬月額を変えてください。</p>}
      {message && <div className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">固定的賃金の変動と判定(直近18か月)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">氏名・変動</th>
                <th className="px-3 py-2 text-right">3か月の日数・報酬</th>
                <th className="px-3 py-2 text-right">平均</th>
                <th className="px-3 py-2 text-right">標準報酬月額</th>
                <th className="px-3 py-2">判定</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.staffName}
                    <span className="block text-xs text-slate-500">
                      {ym(r.month)}から {KIND[r.kind] ?? r.kind} {r.before.toLocaleString()}円 → {r.after.toLocaleString()}円
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums">
                    {r.months.map((m) => (
                      <span key={m.month} className={`block ${m.future ? "text-slate-300" : m.days < 17 ? "text-slate-400" : ""}`}>
                        {Number(m.month.slice(5))}月 {m.days}日 {m.future ? "-" : formatYen(m.pay)}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{r.average === null ? "-" : formatYen(r.average)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {thousand(r.current)}
                    {r.currentGrade !== null && <span className="text-xs text-slate-500">({r.currentGrade}等級)</span>}
                    {r.next !== null && (
                      <span className="block">
                        → {thousand(r.next)}
                        <span className="text-xs text-slate-500">({r.nextGrade}等級)</span>
                      </span>
                    )}
                    {r.diff !== null && r.diff !== 0 && <span className={`block text-xs ${r.diff > 0 ? "text-rose-700" : "text-emerald-700"}`}>{r.diff > 0 ? `${r.diff}等級上がる` : `${-r.diff}等級下がる`}</span>}
                  </td>
                  <td className="min-w-[11rem] px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                    {r.status === "CANDIDATE" && (
                      <>
                        <span className="mt-1 block text-xs text-slate-500">{ym(r.effectiveMonth)}分から</span>
                        <button disabled={busy} onClick={() => call("POST", { action: "apply", id: r.id }, `${r.staffName}さんの標準報酬月額を ${thousand(r.next)} にしました。`)} className="mt-1 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                          反映する
                        </button>
                      </>
                    )}
                    {r.status === "NO_STANDARD" && (
                      <Link href="/payroll/standard" className="mt-1 block text-xs text-indigo-700 hover:underline">
                        算定基礎で決める
                      </Link>
                    )}
                    {r.status === "APPLIED" && (
                      <span className="mt-1 block text-xs text-slate-500">
                        {r.appliedAt?.replaceAll("-", "/")} {r.appliedByName}
                        <button disabled={busy} onClick={() => confirm("反映を取り消して、前の標準報酬月額に戻しますか?") && call("POST", { action: "undo", id: r.id }, "反映を取り消しました。")} className="ml-2 text-rose-700 hover:underline">
                          取り消す
                        </button>
                      </span>
                    )}
                    {r.status !== "APPLIED" && (
                      <button disabled={busy} onClick={() => confirm("この記録を削除しますか?") && call("DELETE", null, "記録を削除しました。", `?id=${r.id}`)} className="mt-1 block text-xs text-slate-400 hover:text-rose-700 hover:underline">
                        記録を削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    まだ変動の記録はありません。時給・通勤手当を変えると自動で記録されます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="mb-2 font-semibold">前に変えた分をあとから記録する</h2>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-5">
          <label className="block">
            <span className="text-slate-600">スタッフ</span>
            <select value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} required className={inputClass}>
              <option value="">選択</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">変わった月(給与の対象月)</span>
            <input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} required className={inputClass} />
          </label>
          <label className="block">
            <span className="text-slate-600">何が変わったか</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputClass}>
              <option value="WAGE">時給</option>
              <option value="COMMUTE">通勤手当</option>
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">変わる前(円)</span>
            <input value={form.before} onChange={(e) => setForm({ ...form, before: e.target.value })} inputMode="numeric" required className={inputClass} />
          </label>
          <label className="block">
            <span className="text-slate-600">変わった後(円)</span>
            <input value={form.after} onChange={(e) => setForm({ ...form, after: e.target.value })} inputMode="numeric" required className={inputClass} />
          </label>
          <div className="sm:col-span-5">
            <button disabled={busy} className="rounded-md border border-indigo-600 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
              記録する
            </button>
          </div>
        </form>
      </section>

      <div className="space-y-1 text-xs text-slate-500">
        <p>・残業代の増減のような非固定的賃金の変動だけでは月額変更になりません。賃金の向き(上がった・下がった)と等級の向きが同じときだけ対象です。</p>
        <p>・まだ計上していない月はシフト・打刻からの見込みで計算します。届出は日本年金機構の電子申請や「届書作成プログラム」で出せます。</p>
      </div>
    </div>
  );
}
