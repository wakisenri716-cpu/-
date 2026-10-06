"use client";

import Link from "next/link";
import { useState } from "react";
import type { FixedCost } from "@/lib/fixedCosts";
import { formatYen } from "@/lib/format";

type Data = { items: FixedCost[]; monthlyTotal: number; yearlyTotal: number; revenue: number; ratio: number | null; priceUps: number; overlaps: number; summary?: string; mode?: "claude" | "template" };

const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  KEEP: { label: "このまま", cls: "bg-slate-100 text-slate-700" },
  CANCEL_CHECK: { label: "使っているか確かめる", cls: "bg-rose-100 text-rose-800" },
  REVIEW_PLAN: { label: "プランを見直す", cls: "bg-amber-100 text-amber-800" },
  NEGOTIATE: { label: "値下げ・相見積もり", cls: "bg-amber-100 text-amber-800" },
  CONSOLIDATE: { label: "まとめる", cls: "bg-sky-100 text-sky-800" },
};
const FLAG_LABEL: Record<string, string> = { PRICE_UP: "値上がり", SAME_KIND: "同じ種類が複数", VARIES: "月で金額が変わる" };

function Advice({ item: i }: { item: FixedCost }) {
  return (
    <>
      {i.suggestion && <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_LABEL[i.suggestion].cls}`}>{ACTION_LABEL[i.suggestion].label}</span>}
      {i.aiNote && <p className="mt-1 text-xs text-indigo-900">AI: {i.aiNote}</p>}
      {i.note && <p className="mt-1 text-xs text-slate-600">{i.note}</p>}
    </>
  );
}

export default function FixedCostsView({ initial, ai }: { initial: Data; ai: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = data.items.filter((i) => i.status === "ACTIVE");
  const stopped = data.items.filter((i) => i.status === "STOPPED");

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fixed-costs", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">毎月の支払い</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatYen(data.monthlyTotal)}</div>
          <div className="text-xs text-slate-500">
            {active.length}件・年間 {formatYen(data.yearlyTotal)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">売上に対する割合</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{data.ratio === null ? "-" : `${Math.round(data.ratio * 1000) / 10}%`}</div>
          <div className="text-xs text-slate-500">直近3か月の売上の平均 {formatYen(data.revenue)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">気をつけたい支払い</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${data.priceUps + data.overlaps ? "text-amber-700" : ""}`}>{data.priceUps + data.overlaps}件</div>
          <div className="text-xs text-slate-500">
            値上がり {data.priceUps}件・同じ種類が複数 {data.overlaps}件
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {ai && active.length > 0 && (
          <button onClick={ask} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy ? "AIが見ています…" : "AIに見直しの候補を聞く"}
          </button>
        )}
      </div>
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {data.summary && <p className={`rounded-lg px-4 py-2 text-sm ${data.mode === "claude" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}>{data.summary}</p>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">毎月の支払い(年間の金額が多い順)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">支払い</th>
                <th className="px-3 py-2 text-right">月の金額</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">年間</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">最近の金額</th>
                <th className="hidden px-3 py-2 sm:table-cell">見直し</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {active.map((i) => (
                <tr key={i.key} className="align-top">
                  <td className="min-w-[12rem] px-3 py-2">
                    <Link href={`/journal?q=${encodeURIComponent(i.label)}`} className="hover:underline">
                      {i.label}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {i.accountName}・{i.months}か月
                    </span>
                    {i.flags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {i.flags.map((f) => (
                          <span key={f} className={`rounded-full px-2 py-0.5 text-xs ${f === "VARIES" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
                            {FLAG_LABEL[f]}
                          </span>
                        ))}
                      </span>
                    )}
                    <div className="mt-1 sm:hidden">
                      <span className="block text-xs text-slate-500">年間 {formatYen(i.yearly)}・最近 {formatYen(i.lastAmount)}</span>
                      <Advice item={i} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatYen(i.monthly)}</td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">{formatYen(i.yearly)}</td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatYen(i.lastAmount)}
                    {i.changePct !== null && i.changePct !== 0 && (
                      <span className={`block text-xs ${i.changePct > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        {i.changePct > 0 ? "+" : ""}
                        {i.changePct}%
                      </span>
                    )}
                  </td>
                  <td className="hidden min-w-[14rem] px-3 py-2 sm:table-cell">
                    <Advice item={i} />
                  </td>
                </tr>
              ))}
              {active.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    毎月くり返している支払いは見つかりませんでした。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {stopped.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">止まった支払い</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {stopped.map((i) => (
              <li key={i.key}>
                {i.label}(月 {formatYen(i.monthly)}): {i.note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
