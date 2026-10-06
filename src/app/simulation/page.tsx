"use client";

import { useState, type FormEvent } from "react";
import { formatYen } from "@/lib/format";
import { CashChart } from "./CashChart";

type Scenario = { revenuePct: number; items: { label: string; monthly: number; from: number }[]; oneTime: { label: string; amount: number; month: number; cashOnly: boolean }[]; notes: string[] };
type Month = { month: string; revenue: number; expense: number; profit: number; baseProfit: number; cash: number; baseCash: number };
type Result = {
  base: { months: string[]; revenue: number; expense: number; cash: number; start: string };
  scenario: Scenario;
  mode: "claude" | "template" | "manual";
  result: { months: Month[]; totals: { profit: number; baseProfit: number; endCash: number; baseEndCash: number }; shortMonth: string | null; baseShortMonth: string | null; comments: string[] };
};

const EXAMPLES = ["来月から1人採用、月給28万円", "売上が10%減ったら", "200万円の設備を購入。1月から毎月3万円の保守費がかかる", "家賃が月5万円上がる。売上が5%増える", "500万円を借りる"];
const ym = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${formatYen(Math.abs(n))}`;
const diff = (a: number, b: number) => `${a - b >= 0 ? "+" : "-"}${formatYen(Math.abs(a - b))}`;

// もしもシミュレーション(採用・値上げ・設備投資・売上の増減で、利益と現預金がどうなるか)
export default function SimulationPage() {
  const [text, setText] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "計算できませんでした");
    setData(body);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run({ text });
  }

  // 条件を1つ外して計算し直す
  function drop(kind: "items" | "oneTime" | "revenue", index = 0) {
    if (!data) return;
    const s = { ...data.scenario };
    if (kind === "revenue") s.revenuePct = 0;
    else s[kind] = s[kind].filter((_, i) => i !== index) as never;
    run({ scenario: s });
  }

  const r = data?.result;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">もしもシミュレーション</h1>
        <p className="mt-1 text-sm text-slate-600">「1人採用したら」「売上が10%減ったら」「設備を買ったら」のときに、これから12か月の利益と現預金がどうなるかを、いまのままと比べます。直近3か月の平均といまの現預金をもとに計算します(何も保存しません)。</p>
      </div>

      <form onSubmit={submit} className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="例: 来月から1人採用(月給28万円)。家賃が月5万円上がる。" className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" aria-label="もしもの内容" />
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy || !text.trim()} className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "計算しています..." : "計算する"}
          </button>
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:border-indigo-300">
              {e}
            </button>
          ))}
        </div>
      </form>

      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}

      {data && r && (
        <>
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">{data.mode === "claude" ? "AIが読み取った条件" : "読み取った条件"}</h2>
            <ul className="space-y-1">
              {data.scenario.revenuePct !== 0 && (
                <li className="flex items-center justify-between gap-2">
                  <span>売上 {data.scenario.revenuePct > 0 ? "+" : ""}{data.scenario.revenuePct}%(毎月 {signed(Math.round((data.base.revenue * data.scenario.revenuePct) / 100))})</span>
                  <button type="button" onClick={() => drop("revenue")} className="shrink-0 text-xs whitespace-nowrap text-slate-500 hover:underline">外す</button>
                </li>
              )}
              {data.scenario.items.map((it, i) => (
                <li key={`i${i}`} className="flex items-center justify-between gap-2">
                  <span>{it.label}: 毎月 {it.monthly > 0 ? "+" : "-"}{formatYen(Math.abs(it.monthly))}({ym(r.months[it.from - 1].month)}から)</span>
                  <button type="button" onClick={() => drop("items", i)} className="shrink-0 text-xs whitespace-nowrap text-slate-500 hover:underline">外す</button>
                </li>
              ))}
              {data.scenario.oneTime.map((o, i) => (
                <li key={`o${i}`} className="flex items-center justify-between gap-2">
                  <span>{o.label}: {ym(r.months[o.month - 1].month)}に {o.amount > 0 ? "支払い" : "入金"} {formatYen(Math.abs(o.amount))}{o.cashOnly ? "(利益には入らないお金の出入り)" : ""}</span>
                  <button type="button" onClick={() => drop("oneTime", i)} className="shrink-0 text-xs whitespace-nowrap text-slate-500 hover:underline">外す</button>
                </li>
              ))}
              {data.scenario.revenuePct === 0 && !data.scenario.items.length && !data.scenario.oneTime.length && <li className="text-slate-500">条件を読み取れませんでした。金額や時期を書いてお試しください。</li>}
            </ul>
            {data.scenario.notes.length > 0 && <ul className="list-disc pl-5 text-xs text-slate-500">{data.scenario.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            <p className="text-xs text-slate-500">
              もとにした数字: 直近3か月({data.base.months.map(ym).join("・")})の平均 売上 {formatYen(data.base.revenue)}・費用 {formatYen(data.base.expense)}/月、いまの現預金 {formatYen(data.base.cash)}。
            </p>
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">12か月の利益</p>
              <p className={`text-xl font-semibold tabular-nums ${r.totals.profit < 0 ? "text-rose-700" : ""}`}>{formatYen(r.totals.profit)}</p>
              <p className="text-xs text-slate-500">いまのまま {formatYen(r.totals.baseProfit)}({diff(r.totals.profit, r.totals.baseProfit)})</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">1年後の現預金</p>
              <p className={`text-xl font-semibold tabular-nums ${r.totals.endCash < 0 ? "text-rose-700" : ""}`}>{formatYen(r.totals.endCash)}</p>
              <p className="text-xs text-slate-500">いまのまま {formatYen(r.totals.baseEndCash)}({diff(r.totals.endCash, r.totals.baseEndCash)})</p>
            </div>
            <div className={`rounded-xl border p-4 shadow-sm ${r.shortMonth ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <p className="text-xs text-slate-600">現預金が足りなくなる月</p>
              <p className={`text-xl font-semibold ${r.shortMonth ? "text-rose-700" : "text-emerald-700"}`}>{r.shortMonth ? ym(r.shortMonth) : "12か月はもちます"}</p>
              <p className="text-xs text-slate-600">いまのまま: {r.baseShortMonth ? ym(r.baseShortMonth) : "12か月はもちます"}</p>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold">現預金の見込み(各月末)</h2>
            <CashChart data={r.months} start={data.base.cash} />
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {r.comments.map((c, i) => (
                <li key={i}>・{c}</li>
              ))}
            </ul>
            <details className="mt-2 text-xs text-slate-600">
              <summary className="cursor-pointer text-indigo-700 hover:underline">表で見る</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">月</th>
                      <th className="py-1 pr-3 text-right font-medium">売上</th>
                      <th className="py-1 pr-3 text-right font-medium">費用</th>
                      <th className="py-1 pr-3 text-right font-medium">利益</th>
                      <th className="py-1 pr-3 text-right font-medium">現預金</th>
                      <th className="py-1 text-right font-medium">いまのまま</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {r.months.map((m) => (
                      <tr key={m.month}>
                        <td className="py-1 pr-3">{ym(m.month)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{formatYen(m.revenue)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{formatYen(m.expense)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{formatYen(m.profit)}</td>
                        <td className={`py-1 pr-3 text-right tabular-nums ${m.cash < 0 ? "text-rose-700" : ""}`}>{formatYen(m.cash)}</td>
                        <td className="py-1 text-right tabular-nums text-slate-500">{formatYen(m.baseCash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p className="mt-2 text-xs text-slate-500">売上・費用は入金・支払いと同じ月に起きるとみなした目安です(売掛金・買掛金・税金の支払い時期は考えていません)。</p>
          </section>
        </>
      )}
    </div>
  );
}
