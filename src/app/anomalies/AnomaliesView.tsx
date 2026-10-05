"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatYen } from "@/lib/format";

type Anomaly = { key: string; type: string; level: "HIGH" | "MEDIUM"; title: string; detail: string; amount: number; href: string };
type Data = { month: string; revenueMonth: string; anomalies: Anomaly[]; checkedCount: number };

const TYPE_LABEL: Record<string, string> = {
  EXPENSE_SPIKE: "費用の急増",
  NEW_SPEND: "いつもはない費用",
  REVENUE_DROP: "売上の急減",
  LARGE_PAYMENT: "大きな支払い",
  NEW_VENDOR: "初めての取引先",
};

function shift(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function AnomaliesView() {
  const [month, setMonth] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (m: string | null) => {
    const res = await fetch(`/api/anomalies${m ? `?month=${m}` : ""}`);
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    setCurrent((c) => c ?? d.month);
  }, []);

  useEffect(() => {
    // Fetch-on-mount / 月の切り替え: setState always lands after the fetch's await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(month);
  }, [load, month]);

  async function check(a: Anomaly) {
    setBusy(a.key);
    const res = await fetch("/api/anomalies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: a.key, title: a.title }) });
    setBusy(null);
    if (res.ok) await load(month);
  }

  if (!data) return null;
  const label = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">いつもと違うお金の動き(異常検知)</h1>
        <p className="mt-1 text-sm text-slate-600">
          過去6か月のいつもの動きと比べて、急に増えた費用、急に減った売上、いつもより大きい支払い、初めての取引先への大きな支払いを見つけます。間違いや不正の早期発見に使ってください。問題がなければ「確認した」を押すと、次から出なくなります。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setMonth(shift(data.month, -1))} className="rounded-md border px-2 py-1 hover:bg-slate-50" aria-label="前の月">
          ◀
        </button>
        <span className="font-medium">{label(data.month)}</span>
        <button onClick={() => setMonth(shift(data.month, 1))} disabled={!current || data.month >= current} className="rounded-md border px-2 py-1 hover:bg-slate-50 disabled:opacity-30" aria-label="次の月">
          ▶
        </button>
        <span className="text-xs text-slate-500">(売上は終わった月 {label(data.revenueMonth)} で比べます)</span>
        {data.checkedCount > 0 && <span className="ml-auto text-xs text-slate-500">確認済み {data.checkedCount}件</span>}
      </div>

      <div className="space-y-3">
        {data.anomalies.map((a) => (
          <section key={a.key} className={`rounded-xl border bg-white p-4 text-sm shadow-sm ${a.level === "HIGH" ? "border-rose-200" : "border-amber-200"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.level === "HIGH" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{TYPE_LABEL[a.type] ?? a.type}</span>
                <p className="mt-1 font-medium">{a.title}</p>
                <p className="text-slate-600">{a.detail}</p>
              </div>
              <span className="text-lg font-semibold whitespace-nowrap tabular-nums">{formatYen(a.amount)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link href={a.href} className="text-xs text-indigo-700 hover:underline">
                中身を見る
              </Link>
              <button disabled={busy === a.key} onClick={() => check(a)} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                確認した(問題なし)
              </button>
            </div>
          </section>
        ))}
        {data.anomalies.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{label(data.month)}は、いつもと違う動きは見つかりませんでした。</p>}
      </div>
    </div>
  );
}
