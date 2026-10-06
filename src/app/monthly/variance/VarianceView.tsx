"use client";

import Link from "next/link";
import { useState } from "react";
import type { VarianceItem } from "@/lib/budgetVariance";
import { formatYen } from "@/lib/format";

type Data = { year: number; elapsed: number; checked: number; items: VarianceItem[]; summary?: string; mode?: "claude" | "template" };

const STATUS: Record<string, { label: string; cls: string }> = {
  OVER: { label: "予算を超えた", cls: "bg-rose-100 text-rose-800" },
  RISK: { label: "超えそう", cls: "bg-amber-100 text-amber-800" },
  BEHIND: { label: "届かなそう", cls: "bg-amber-100 text-amber-800" },
};

// 月ごとの実績の棒と、月の予算の線。数字は下の表にも出す
function MonthBars({ item }: { item: VarianceItem }) {
  const max = Math.max(item.monthlyBudget, ...item.months.map((m) => m.amount), 1);
  return (
    <div>
      <div className="relative flex h-24 items-end gap-1 border-b border-slate-200" aria-hidden>
        <span className="absolute inset-x-0 border-t border-dashed border-slate-500" style={{ bottom: `${(item.monthlyBudget / max) * 100}%` }} />
        {item.months.map((m) => (
          <span
            key={m.month}
            title={`${m.month.replace("-", "/")} ${formatYen(m.amount)}`}
            className={`flex-1 rounded-t ${m.flag === "HIGH" ? "bg-rose-500" : m.flag === "LOW" ? "bg-amber-500" : m.partial ? "bg-indigo-300" : "bg-indigo-500"}`}
            style={{ height: `${(Math.max(m.amount, 0) / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-slate-500">
        {item.months.map((m) => (
          <span key={m.month} className="flex-1 text-center">
            {Number(m.month.slice(5))}月{m.flag === "EMPTY" && <span className="block text-rose-600">なし</span>}
          </span>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">点線は月の予算 {formatYen(item.monthlyBudget)}{item.months.some((m) => m.partial) && "・薄い棒は今月(途中)"}
        {item.months.some((m) => m.flag === "EMPTY") && "・「なし」は会社全体で記帳のない月"}</p>
    </div>
  );
}

function Item({ item }: { item: VarianceItem }) {
  const bad = item.kind === "EXPENSE" ? "多い" : "足りない";
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Link href={`/ledger?accountId=${item.accountId}`} className="font-semibold hover:underline">
          {item.code} {item.name}
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[item.status]?.cls ?? ""}`}>{STATUS[item.status]?.label}</span>
        <span className="ml-auto text-sm text-slate-600 tabular-nums">
          年間で {formatYen(Math.max(0, item.forecastGap))} {item.kind === "EXPENSE" ? "超える見込み" : "届かない見込み"}
        </span>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">年間予算</dt>
            <dd className="text-right tabular-nums">{formatYen(item.budget)}</dd>
            <dt className="text-slate-500">今月までの予算</dt>
            <dd className="text-right tabular-nums">{formatYen(item.pace)}</dd>
            <dt className="text-slate-500">実績</dt>
            <dd className="text-right tabular-nums">
              {formatYen(item.actual)}
              {item.paceGap > 0 && <span className="block text-xs text-rose-700">{formatYen(item.paceGap)} {bad}</span>}
            </dd>
            <dt className="text-slate-500">着地見込み</dt>
            <dd className="text-right tabular-nums">{formatYen(item.forecast)}</dd>
          </dl>
          <MonthBars item={item} />
        </div>
        <div className="space-y-3 text-sm">
          {(item.aiCause || item.aiAction) && (
            <div className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-900">
              {item.aiCause && <p>AIの見立て: {item.aiCause}</p>}
              {item.aiAction && <p className="mt-1 font-medium">次にやること: {item.aiAction}</p>}
            </div>
          )}
          <ul className="list-disc space-y-1 pl-5 text-slate-700">
            {item.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {item.drivers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">取引(摘要)</th>
                    <th className="py-1 pr-2 text-right">今期</th>
                    {item.basis === "lastYear" && <th className="py-1 pr-2 text-right">前年の同じ時期</th>}
                    {item.basis === "lastYear" && <th className="py-1 text-right">差</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {item.drivers.map((d) => (
                    <tr key={d.label + d.journalId}>
                      <td className="py-1 pr-2">
                        <Link href={`/journal?q=${encodeURIComponent(d.label)}`} className="hover:underline">
                          {d.label}
                        </Link>
                        {d.count > 1 && <span className="text-slate-400"> ×{d.count}</span>}
                      </td>
                      <td className="py-1 pr-2 text-right whitespace-nowrap tabular-nums">{formatYen(d.current)}</td>
                      {item.basis === "lastYear" && <td className="py-1 pr-2 text-right whitespace-nowrap tabular-nums">{formatYen(d.previous)}</td>}
                      {item.basis === "lastYear" && (
                        <td className="py-1 text-right whitespace-nowrap tabular-nums">
                          {d.diff > 0 ? "+" : "−"}
                          {formatYen(Math.abs(d.diff))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function VarianceView({ initial, ai }: { initial: Data; ai: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/budgets/variance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fiscalYear: String(initial.year) }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (data.elapsed === 0) return <p className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-500">この年度はまだ始まっていません。</p>;
  if (!data.items.length)
    return (
      <p className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-500">
        {data.checked ? `予算から大きく外れている科目はありません(予算を入れた${data.checked}科目を確かめました)。` : "予算を入れた科目がありません。"}
        <Link href={`/monthly/budget?fy=${data.year}`} className="ml-1 text-indigo-700 hover:underline">
          予算を入れる・直す
        </Link>
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-700">予算から外れている科目: {data.items.length}件</p>
        {ai && (
          <button type="button" onClick={ask} disabled={busy} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy ? "AIが調べています…" : "AIに原因を聞く"}
          </button>
        )}
      </div>
      {error && <p className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {data.summary && <p className={`rounded-lg px-4 py-2 text-sm ${data.mode === "claude" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}>{data.summary}</p>}
      {data.items.map((item) => (
        <Item key={item.accountId} item={item} />
      ))}
    </div>
  );
}
