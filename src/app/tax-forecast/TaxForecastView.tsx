"use client";

import { useState } from "react";
import type { getTaxForecast } from "@/lib/taxForecast";
import { SAVING_OPTIONS, applyOptions } from "@/lib/taxSavingOptions";
import { formatYen } from "@/lib/format";

type Forecast = Awaited<ReturnType<typeof getTaxForecast>>;
type Advice = { summary: string; points: string[] };

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatYen(Math.abs(n))}`;

export default function TaxForecastView({ f, ai }: { f: Forecast; ai: boolean }) {
  const [amounts, setAmounts] = useState<Record<string, number>>(Object.fromEntries(SAVING_OPTIONS.map((o) => [o.key, 0])));
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effect = applyOptions(f, amounts);
  const max = Math.max(1, ...f.months.map((m) => Math.max(m.revenue, m.expense)));

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tax-forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amounts }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setAdvice(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (!f.inProgress) return <p className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-500">今期は終わっています。法人税等の計算の画面で確かめてください。</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">期末の利益の見込み(税引前)</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${f.forecast.pretax < 0 ? "text-rose-700" : ""}`}>{f.ready ? formatYen(f.forecast.pretax) : "-"}</div>
          <div className="text-xs text-slate-500">いままでの実績 {formatYen(f.actual.pretax)}・残り{f.remaining}か月</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">法人税等の目安</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{f.ready ? formatYen(f.result.total) : "-"}</div>
          <div className="text-xs text-slate-500">利益の約{f.result.rate === null ? "-" : Math.round(f.result.rate * 100)}%</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">納付の見込み(中間納付を引いた額)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{f.ready ? formatYen(f.payable) : "-"}</div>
          <div className="text-xs text-slate-500">期限 {f.deadline.replaceAll("-", "/")}・中間納付 {formatYen(f.interim)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">いまの現預金</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${f.ready && f.cash < f.payable ? "text-rose-700" : ""}`}>{formatYen(f.cash)}</div>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {f.findings.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">月ごとの売上と費用(薄い色は見込み)</h2>
        <div className="mt-3 overflow-x-auto">
          <div className="flex h-36 min-w-[36rem] items-end gap-2 border-b border-slate-200" role="img" aria-label="月ごとの売上と費用のグラフ。棒にカーソルを合わせると金額が出ます">
            {f.months.map((m) => {
              const rev = m.done ? m.revenue : f.run.revenue;
              const exp = m.done ? m.expense : f.run.expense;
              return (
                <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-0.5" title={`${m.month.replace("-", "/")} 売上 ${formatYen(rev)}・費用 ${formatYen(exp)}${m.done ? "" : "(見込み)"}`}>
                  <span className={`w-3 rounded-t ${m.done ? "bg-indigo-500" : "bg-indigo-200"}`} style={{ height: `${(Math.max(rev, 0) / max) * 100}%` }} />
                  <span className={`w-3 rounded-t ${m.done ? "bg-amber-500" : "bg-amber-200"}`} style={{ height: `${(Math.max(exp, 0) / max) * 100}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex min-w-[36rem] gap-2 pt-1 text-center text-[10px] text-slate-500">
            {f.months.map((m) => (
              <span key={m.month} className="flex-1">
                {Number(m.month.slice(5))}月
              </span>
            ))}
          </div>
        </div>
        <p className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded bg-indigo-500" />
            売上
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded bg-amber-500" />
            費用
          </span>
          <span>見込みの月は、直近{f.run.months}か月の平均(売上 {formatYen(f.run.revenue)}・費用 {formatYen(f.run.expense)})</span>
        </p>
      </section>

      {f.ready && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">決算までにできること(金額を入れると、税金とお金の動きを計算します)</h2>
          <div className="divide-y">
            {SAVING_OPTIONS.map((o) => (
              <div key={o.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_10rem]">
                <div>
                  <div className="text-sm font-medium">{o.title}</div>
                  <p className="text-xs text-slate-600">{o.detail}</p>
                  <p className="text-xs text-amber-800">注意: {o.caution}</p>
                </div>
                <label className="flex flex-col text-xs text-slate-500">
                  金額(円)
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={amounts[o.key] || ""}
                    placeholder="0"
                    onChange={(e) => setAmounts({ ...amounts, [o.key]: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    className="mt-1 rounded border px-2 py-1 text-right text-sm text-slate-900"
                    aria-label={`${o.title}の金額`}
                  />
                </label>
              </div>
            ))}
          </div>
          {effect.total > 0 && (
            <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">費用にする合計</div>
                <div className="font-semibold tabular-nums">{formatYen(effect.total)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">法人税等の目安</div>
                <div className="font-semibold tabular-nums">
                  {formatYen(effect.taxAfter)} <span className="text-xs font-normal text-emerald-700">({signed(-effect.taxSaved)})</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">出ていくお金</div>
                <div className="font-semibold tabular-nums">{formatYen(effect.cashOut)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">手元に残るお金の差</div>
                <div className={`font-semibold tabular-nums ${effect.netCash < 0 ? "text-rose-700" : "text-emerald-700"}`}>{signed(effect.netCash)}</div>
              </div>
            </div>
          )}
          {effect.total > 0 && effect.netCash < 0 && <p className="text-xs text-slate-600">税金は減りますが、使うお金のほうが多いので手元のお金は減ります。必要な支出かどうかで決めましょう。</p>}
          <div className="flex flex-wrap items-center gap-3">
            {ai && (
              <button onClick={ask} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                {busy ? "AIが考えています…" : "AIに見立てを聞く"}
              </button>
            )}
            <span className="text-xs text-slate-500">制度の条件・期限は会社ごとに違い、変わることもあります。実行の前に税理士に確かめてください。</span>
          </div>
          {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
          {advice && (
            <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <p>{advice.summary}</p>
              {advice.points.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {advice.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
