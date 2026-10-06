"use client";

import Link from "next/link";
import { useState } from "react";
import type { CustomerProfitRow } from "@/lib/customerProfit";
import { formatYen } from "@/lib/format";

type Data = { from: string; to: string; rows: CustomerProfitRow[]; totalRevenue: number; avgPerHour: number | null; hasCosts: boolean; findings: string[]; summary?: string };

const ACTION: Record<string, { label: string; cls: string }> = {
  RAISE_PRICE: { label: "単価を見直す", cls: "bg-rose-100 text-rose-800" },
  SCOPE: { label: "作業の範囲を見直す", cls: "bg-amber-100 text-amber-800" },
  TERMS: { label: "支払い条件を相談", cls: "bg-amber-100 text-amber-800" },
  NURTURE: { label: "大事にする・取引を増やす", cls: "bg-emerald-100 text-emerald-800" },
  KEEP: { label: "このまま", cls: "bg-slate-100 text-slate-700" },
};
const yen = (n: number) => (n < 0 ? `−${formatYen(-n)}` : formatYen(n));
const FLAG: Record<string, string> = { LOSS: "赤字", LOW_MARGIN: "粗利率が低い", HOURS_HEAVY: "手間のわりに粗利が少ない", LATE: "入金が遅れがち" };

export default function CustomerProfitView({ initial, ai }: { initial: Data; ai: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxRevenue = Math.max(1, ...data.rows.map((r) => r.revenue));

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customer-profit", { method: "POST" });
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
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {data.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {!data.hasCosts && data.rows.length > 0 && (
        <p className="text-sm">
          <Link href="/projects" className="text-indigo-700 hover:underline">
            案件を作って顧客名を入れる →
          </Link>
        </p>
      )}
      {ai && data.rows.length > 0 && (
        <button onClick={ask} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          {busy ? "AIが見ています…" : "AIに次の一手を聞く"}
        </button>
      )}
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {data.summary && <p className="rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-900">{data.summary}</p>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b px-4 py-2 text-sm font-semibold">顧客ごと(粗利の多い順)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="px-3 py-2">顧客</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">売上(税抜)</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">原価・経費</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">作業</th>
                <th className="px-3 py-2 text-right">粗利</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">1時間あたり</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">入金</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <td className="min-w-[13rem] px-3 py-2">
                    {r.customerId ? (
                      <Link href={`/vendors/customer/${r.customerId}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    <span className="mt-1 block h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
                      <span className="block h-1.5 rounded-full bg-indigo-500" style={{ width: `${(r.revenue / maxRevenue) * 100}%` }} />
                    </span>
                    <span className="block text-xs text-slate-500">
                      売上の{r.share}%・請求書{r.invoices}件
                    </span>
                    <span className="block text-xs text-slate-500 sm:hidden">
                      売上 {formatYen(r.revenue)}・原価・経費 {formatYen(r.cost + r.laborCost)}
                      {r.hours ? `・作業 ${r.hours}時間` : ""}
                      {r.avgLateDays !== null && r.avgLateDays > 0 ? `・入金 平均${r.avgLateDays}日遅れ` : ""}
                      {r.overdue > 0 ? `・未入金 ${formatYen(r.overdue)}` : ""}
                    </span>
                    {r.flags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.flags.map((f) => (
                          <span key={f} className={`rounded-full px-2 py-0.5 text-xs ${f === "LOSS" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                            {FLAG[f]}
                          </span>
                        ))}
                      </span>
                    )}
                    {r.suggestion && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACTION[r.suggestion].cls}`}>{ACTION[r.suggestion].label}</span>}
                    {r.aiNote && <p className="mt-1 text-xs text-indigo-900">AI: {r.aiNote}</p>}
                  </td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">{formatYen(r.revenue)}</td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">{formatYen(r.cost)}</td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {r.hours ? `${r.hours}時間` : "-"}
                    {r.laborCost > 0 && <span className="block text-xs text-slate-500">{formatYen(r.laborCost)}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${r.gross < 0 ? "text-rose-700" : ""}`}>
                    {yen(r.gross)}
                    {r.margin !== null && <span className="block text-xs text-slate-500">{r.margin}%</span>}
                  </td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">{r.grossPerHour === null ? "-" : yen(r.grossPerHour)}</td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {r.avgLateDays === null ? "-" : r.avgLateDays > 0 ? `平均${r.avgLateDays}日遅れ` : "期日どおり"}
                    {r.overdue > 0 && <span className="block text-xs text-rose-700">未入金 {formatYen(r.overdue)}</span>}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    直近12か月に発行した請求書がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data.avgPerHour !== null && <p className="px-4 py-2 text-xs text-slate-500">作業時間のある顧客の、1時間あたりの粗利の平均: {formatYen(data.avgPerHour)}</p>}
      </section>
    </div>
  );
}
