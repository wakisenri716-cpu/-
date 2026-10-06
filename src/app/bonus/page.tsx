"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Staff = { id: string; name: string; dependents: number; taxColumn: string; socialInsurance: boolean; careInsurance: boolean; employmentInsurance: boolean; previousTaxable: number | null };
type Overview = { runs: { id: string; label: string; payDate: string; people: number; total: number; netPay: number }[]; previousMonth: string | null; staff: Staff[] };
type Row = { staffId: string; name: string; amount: number; standard: number; health: number; care: number; pension: number; employment: number; socialTotal: number; taxable: number; taxRate: number; incomeTax: number; netPay: number; employerSocial: number };
type Preview = { rows: Row[]; totals: Record<string, number> };

function defaultLabel() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1 >= 10 || d.getMonth() + 1 <= 3 ? "冬季" : "夏季"}賞与`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BonusPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [label, setLabel] = useState(defaultLabel);
  const [payDate, setPayDate] = useState(today);
  const [inputs, setInputs] = useState<Record<string, { amount: string; taxRate: string }>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/bonus");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const items = Object.entries(inputs)
    .filter(([, v]) => Number(v.amount) > 0)
    .map(([staffId, v]) => ({ staffId, amount: Number(v.amount), taxRate: Number(v.taxRate || 0) }));

  async function send(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "処理できませんでした");
      return null;
    }
    return json;
  }

  async function calc() {
    const result = await send("/api/bonus/preview", "POST", { payDate, items });
    if (result) setPreview(result);
  }

  async function post() {
    if (!confirm(`${label}を計上しますか?(仕訳を作ります)`)) return;
    const result = await send("/api/bonus", "POST", { label, payDate, items });
    if (result) {
      setMessage(`${label}を計上しました。「振込データ」の賞与振込でファイルを作れます。`);
      setPreview(null);
      setInputs({});
      await load();
    }
  }

  async function cancel(id: string, name: string) {
    if (!confirm(`${name}の計上を取り消しますか?(仕訳は取消になります)`)) return;
    if (await send(`/api/bonus/${id}`, "DELETE", undefined)) {
      setMessage(`${name}の計上を取り消しました`);
      await load();
    }
  }

  const cell = "px-2 py-2 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">賞与</h1>
        <p className="mt-1 text-sm text-slate-600">
          ボーナスの支給額を入れると、社会保険料(標準賞与額)・雇用保険料・源泉所得税を差し引いた手取りを計算し、計上すると仕訳を作ります。
          源泉所得税の率は、国税庁の「賞与に対する源泉徴収税額の算出率の表」で確かめて入れてください。
        </p>
      </div>

      {error && <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</div>}

      {data && data.runs.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b px-4 py-3 font-semibold">計上した賞与</h2>
          <ul className="divide-y text-sm">
            {data.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div>
                  <span className="font-medium">{r.label}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    支給日 {r.payDate.replaceAll("-", "/")} ・ {r.people}人
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span>
                    総支給 <span className="font-semibold tabular-nums">{formatYen(r.total)}</span> ・ 差引支給 <span className="font-semibold tabular-nums">{formatYen(r.netPay)}</span>
                  </span>
                  <Link href={`/bonus/${r.id}`} className="text-indigo-700 hover:underline">
                    明細
                  </Link>
                  <button onClick={() => cancel(r.id, r.label)} className="text-slate-500 hover:text-rose-700 hover:underline">
                    取消
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold">新しい賞与</h2>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="text-slate-600">名前</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} className="mt-1 block rounded-md border px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">支給日</span>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 block rounded-md border px-3 py-2" />
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">スタッフ</th>
                  <th className="px-3 py-2">算出率を調べる情報</th>
                  <th className="px-3 py-2">支給額(円)</th>
                  <th className="px-3 py-2">算出率(%)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.staff.map((s) => {
                  const v = inputs[s.id] ?? { amount: "", taxRate: "" };
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{s.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {s.taxColumn === "OTSU" ? "乙欄" : `甲欄・扶養${s.dependents}人`} ・ 前月の社会保険料等控除後の給与{" "}
                        {s.previousTaxable === null ? "なし(月額表で計算)" : formatYen(s.previousTaxable)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={v.amount}
                          onChange={(e) => setInputs((p) => ({ ...p, [s.id]: { ...v, amount: e.target.value } }))}
                          inputMode="numeric"
                          placeholder="0"
                          className="w-32 rounded-md border px-2 py-1.5"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={v.taxRate}
                          onChange={(e) => setInputs((p) => ({ ...p, [s.id]: { ...v, taxRate: e.target.value } }))}
                          inputMode="decimal"
                          placeholder="例: 4.084"
                          className="w-24 rounded-md border px-2 py-1.5"
                        />
                      </td>
                    </tr>
                  );
                })}
                {data.staff.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      「シフト管理」でスタッフを登録してください
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={calc} disabled={busy || items.length === 0} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              計算する
            </button>
            <button onClick={post} disabled={busy || !preview} className="rounded-md bg-vermilion-600 px-4 py-2 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
              計上する
            </button>
          </div>

          {preview && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">スタッフ</th>
                    <th className="px-2 py-2 text-right">支給額</th>
                    <th className="px-2 py-2 text-right">標準賞与額</th>
                    <th className="px-2 py-2 text-right">健康・介護</th>
                    <th className="px-2 py-2 text-right">厚生年金</th>
                    <th className="px-2 py-2 text-right">雇用保険</th>
                    <th className="px-2 py-2 text-right">源泉所得税</th>
                    <th className="px-2 py-2 text-right">差引支給額</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.rows.map((r) => (
                    <tr key={r.staffId}>
                      <td className="px-2 py-2 font-medium whitespace-nowrap">{r.name}</td>
                      <td className={cell}>{formatYen(r.amount)}</td>
                      <td className={cell}>{formatYen(r.standard)}</td>
                      <td className={cell}>{formatYen(r.health + r.care)}</td>
                      <td className={cell}>{formatYen(r.pension)}</td>
                      <td className={cell}>{formatYen(r.employment)}</td>
                      <td className={cell}>
                        {formatYen(r.incomeTax)}
                        <span className="block text-[11px] text-slate-400">{r.taxRate}%</span>
                      </td>
                      <td className={`${cell} font-semibold`}>{formatYen(r.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-slate-50 font-semibold">
                    <td className="px-2 py-2">合計</td>
                    <td className={cell}>{formatYen(preview.totals.amount)}</td>
                    <td />
                    <td className={cell}>{formatYen(preview.totals.health + preview.totals.care)}</td>
                    <td className={cell}>{formatYen(preview.totals.pension)}</td>
                    <td className={cell}>{formatYen(preview.totals.employment)}</td>
                    <td className={cell}>{formatYen(preview.totals.incomeTax)}</td>
                    <td className={cell}>{formatYen(preview.totals.netPay)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="border-t px-3 py-2 text-xs text-slate-500">会社負担の社会保険料 {formatYen(preview.totals.employerSocial)} も一緒に計上します。</p>
            </div>
          )}
          <p className="text-xs text-slate-500">
            標準賞与額は支給額の1,000円未満を切り捨てた額で、健康保険・介護保険は年度(4月〜翌3月)の累計573万円まで、厚生年金は1回150万円までです。
            前月に給料がない人や、賞与が前月の給料の10倍を超える人は、算出率の表ではなく月額表を使って計算します(その場合は計算した税額に合う率を入れてください)。
          </p>
        </section>
      )}
    </div>
  );
}
