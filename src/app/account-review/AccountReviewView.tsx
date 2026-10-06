"use client";

import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import { formatYen } from "@/lib/format";

type Suggestion = {
  lineId: string;
  entryId: string;
  date: string;
  description: string;
  amount: number;
  vendorId: string | null;
  vendorName: string | null;
  from: { code: string; name: string };
  to: { code: string; name: string };
  reason: string;
  source: "keyword" | "vendor" | "ai";
};
type Data = { suggestions: Suggestion[]; checked: number; review: { summary: string; mode: string; createdAt: string; createdBy: string } | null };

const SOURCE: Record<Suggestion["source"], { label: string; cls: string }> = {
  keyword: { label: "摘要の言葉", cls: "bg-sky-100 text-sky-800" },
  vendor: { label: "取引先のいつもの科目", cls: "bg-amber-100 text-amber-800" },
  ai: { label: "AIの見立て", cls: "bg-indigo-100 text-indigo-700" },
};

function Row({ s, accounts, onDone }: { s: Suggestion; accounts: { code: string; name: string }[]; onDone: (lineId: string, note: string) => void }) {
  const [code, setCode] = useState(s.to.code);
  const [vendorDefault, setVendorDefault] = useState(s.source === "vendor" ? false : !!s.vendorId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "fix" | "keep") {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, lineId: s.lineId, code, setVendorDefault: vendorDefault }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "できませんでした");
    onDone(s.lineId, action === "fix" ? `✓ ${json.note}` : "この科目のままにしました");
  }
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 tabular-nums">
            {s.date.replaceAll("-", "/")}
            {s.vendorName ? `・${s.vendorName}` : ""}
          </p>
          <p className="font-medium break-words">{s.description}</p>
        </div>
        <span className="shrink-0 font-semibold tabular-nums">{formatYen(s.amount)}</span>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${SOURCE[s.source].cls}`}>{SOURCE[s.source].label}</span>
        <span>
          いまの科目 <b>{s.from.name}</b> → <b className="text-indigo-700">{s.to.name}</b>
        </span>
      </p>
      <p className="mt-1 text-sm text-slate-600">{s.reason}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-slate-600">直す先</span>
          <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
            {accounts
              .filter((a) => a.code !== s.from.code)
              .map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        {s.vendorId && s.source !== "vendor" && (
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={vendorDefault} onChange={(e) => setVendorDefault(e.target.checked)} />
            次から{s.vendorName}はこの科目にする
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => act("fix")} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
          振替の仕訳を作って直す
        </button>
        <button disabled={busy} onClick={() => act("keep")} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          この科目で合っている
        </button>
      </div>
    </li>
  );
}

export function AccountReviewView({ initial, accounts }: { initial: Data; accounts: { code: string; name: string }[] }) {
  const [data, setData] = useState(initial);
  const [done, setDone] = useState<{ lineId: string; note: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function review() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review" }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "見直せませんでした");
    setData(json);
    setDone([]);
  }
  const doneIds = new Set(done.map((d) => d.lineId));
  const open = data.suggestions.filter((s) => !doneIds.has(s.lineId));
  return (
    <>
      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <SparkleIcon className="h-4 w-4" />
            AIの見直し
          </h2>
          <button onClick={review} disabled={busy} className="rounded-md bg-vermilion-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-vermilion-700 disabled:opacity-50">
            {busy ? "AIが仕訳を読んでいます…" : data.review ? "もう一度AIに見直してもらう" : "AIに見直してもらう"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        {data.review ? (
          <>
            <p className="mt-2 text-sm">{data.review.summary}</p>
            <p className="mt-1 text-xs text-slate-500">
              {data.review.mode === "claude" ? "AIが見直しました" : "決まったルールで見直しました"}({new Date(data.review.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{data.review.createdBy})。最終的な判断は税理士に相談してください。
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">下の決まったルールの結果に加えて、AIが摘要・取引先・金額を読んで、ほかにも科目が違いそうな仕訳を探します。</p>
        )}
      </section>

      {done.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {done.map((d) => (
            <li key={d.lineId}>{d.note}</li>
          ))}
        </ul>
      )}

      {open.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">直近180日の経費の仕訳 {data.checked}件 に、見直したいものは見つかりませんでした。</div>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            経費の仕訳 {data.checked}件 のうち、科目を見直したいものが <b>{open.length}件</b> あります。
          </p>
          <ul className="space-y-3">
            {open.map((s) => (
              <Row key={s.lineId} s={s} accounts={accounts} onDone={(lineId, note) => setDone((d) => [...d, { lineId, note }])} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
