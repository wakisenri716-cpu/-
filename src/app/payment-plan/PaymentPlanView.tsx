"use client";

import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

type Row = {
  invoiceId: string;
  invoiceNumber: string | null;
  vendor: string;
  dueDate: string | null;
  payDate: string;
  remaining: number;
  group: "OVERDUE" | "THIS_WEEK" | "NEXT_WEEK";
  action: "PAY" | "DEFER";
  hasAccount: boolean;
  reason: string;
  aiNote: string | null;
};
type Plan = {
  today: string;
  horizon: string;
  cashNow: number;
  buffer: number;
  suggestedBuffer: number;
  receipts: number;
  receiptCount: number;
  payTotal: number;
  deferTotal: number;
  endBalance: number;
  lowest: { date: string; balance: number };
  rows: Row[];
  later: { count: number; total: number };
  review: { summary: string; mode: string; createdAt: string; createdBy: string; buffer: number; current: boolean } | null;
};

const GROUPS: { key: Row["group"]; label: string }[] = [
  { key: "OVERDUE", label: "期限切れ" },
  { key: "THIS_WEEK", label: "今週(7日以内)" },
  { key: "NEXT_WEEK", label: "来週(8〜14日)" },
];
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : "-");

export function PaymentPlanView({ initial }: { initial: Plan }) {
  const [plan, setPlan] = useState(initial);
  const [buffer, setBuffer] = useState(String(initial.buffer));
  const [selected, setSelected] = useState<string[]>(initial.rows.filter((r) => r.action === "PAY" && r.hasAccount).map((r) => r.invoiceId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(next: Plan) {
    setPlan(next);
    setSelected(next.rows.filter((r) => r.action === "PAY" && r.hasAccount).map((r) => r.invoiceId));
  }
  async function recalc() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/payment-plan?buffer=${encodeURIComponent(buffer)}`);
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "計算できませんでした");
    load(json);
  }
  async function review() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/payment-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buffer }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "見直せませんでした");
    load(json);
  }
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedTotal = plan.rows.filter((r) => selected.includes(r.invoiceId)).reduce((s, r) => s + r.remaining, 0);

  return (
    <>
      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの見立て
          </h2>
          <button onClick={review} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "AIが読んでいます…" : plan.review?.current ? "もう一度AIに見てもらう" : "AIに見てもらう"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        {plan.review?.current ? (
          <>
            <p className="mt-2 text-sm">{plan.review.summary}</p>
            <p className="mt-1 text-xs text-slate-500">
              {plan.review.mode === "claude" ? "AIが見立てました" : "決まったルールでまとめました"}({new Date(plan.review.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{plan.review.createdBy})
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">支払いの順番、ずらす相談の伝え方、期限切れの連絡などを、AIが支払いごとに一言ずつ書きます(支払う・ずらすの判定は変えません)。</p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-4">
        {(
          [
            ["いまの現預金", plan.cashNow, ""],
            [`入金予測(${plan.receiptCount}件)`, plan.receipts, "text-emerald-700"],
            ["支払う", plan.payTotal, ""],
            ["ずらす相談", plan.deferTotal, plan.deferTotal ? "text-rose-700" : ""],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`text-xl font-semibold tabular-nums ${tone}`}>{formatYen(value)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">手元に残したい金額</span>
          <input value={buffer} onChange={(e) => setBuffer(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-right tabular-nums" />
        </label>
        <button onClick={recalc} disabled={busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
          この金額で計算し直す
        </button>
        <p className="text-xs text-slate-500">
          目安はふだんの1か月の支出の半分({formatYen(plan.suggestedBuffer)})。2週間で最も低くなるのは {md(plan.lowest.date)} の {formatYen(plan.lowest.balance)}、{md(plan.horizon)} の残高は {formatYen(plan.endBalance)} の見込みです。
        </p>
      </div>

      {plan.rows.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">この2週間に支払期限の来る請求書はありません。</div>
      ) : (
        GROUPS.filter((g) => plan.rows.some((r) => r.group === g.key)).map((g) => (
          <section key={g.key} className="space-y-2">
            <h2 className={`text-sm font-semibold ${g.key === "OVERDUE" ? "text-rose-700" : "text-slate-700"}`}>{g.label}</h2>
            <ul className="space-y-2">
              {plan.rows
                .filter((r) => r.group === g.key)
                .map((r) => (
                  <li key={r.invoiceId} className={`rounded-xl border bg-white p-3 shadow-sm ${r.action === "DEFER" ? "border-rose-200" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="flex min-w-0 items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={selected.includes(r.invoiceId)} disabled={!r.hasAccount} onChange={() => toggle(r.invoiceId)} />
                        <span className="min-w-0">
                          <span className="block font-medium break-words">
                            {r.vendor}
                            <span className="ml-2 text-xs font-normal text-slate-500">{r.invoiceNumber ?? ""}</span>
                          </span>
                          <span className="block text-sm text-slate-600">
                            期限 {md(r.dueDate)}・支払日 {md(r.payDate)}
                          </span>
                        </span>
                      </label>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {!r.hasAccount && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs whitespace-nowrap text-amber-800">振込先の口座なし</span>}
                        <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${r.action === "PAY" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"}`}>{r.action === "PAY" ? "支払う" : "ずらす相談"}</span>
                        <span className="font-semibold tabular-nums">{formatYen(r.remaining)}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{r.reason}</p>
                    {r.aiNote && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-indigo-800">
                        <SparkleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                        {r.aiNote}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}

      {plan.later.count > 0 && (
        <p className="text-sm text-slate-600">
          それより先に期限の来る支払いが {plan.later.count}件・{formatYen(plan.later.total)} あります(
          <Link href="/receivables" className="text-indigo-700 hover:underline">
            買掛金
          </Link>
          )。
        </p>
      )}

      {plan.rows.length > 0 && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-sm">
            選んだ支払い {selected.length}件・<b className="tabular-nums">{formatYen(selectedTotal)}</b>
          </span>
          {selected.length > 0 ? (
            <Link href={`/transfers?invoices=${selected.join(",")}`} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              選んだ支払いの振込データを作る →
            </Link>
          ) : (
            <span className="text-xs text-slate-500">振り込む請求書を選んでください</span>
          )}
        </div>
      )}
    </>
  );
}
